import type {
  AgentCommand,
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  ApprovalPolicy,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  PermissionOption,
  PermissionOutcome,
  StartOptions,
  TokenUsage,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import { EffortLevelSchema, textBlock } from '@linkcode/schema';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant, nullthrow } from 'foxts/guard';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { AUTH_FAILED_ERROR_CODE } from '../../adapter';
import { BaseAgentAdapter } from '../../base';
import { codexEnv, readAgentCredential } from '../../credential';
import {
  asHistoryId,
  asMessageId,
  boundedLimit,
  cursorFromTotal,
  cursorOffset,
  isRecord,
  numberField,
  recordField,
  sliceHistoryEventPage,
  stringField,
} from '../../history-util';
import { agentRuntimeProber } from '../../probe';
import type { CodexAppServerOptions } from './app-server';
import { CodexAppServer, resolveCodexBinaryPath } from './app-server';
import type { CodexSandboxMode } from './config';
import { codexConfiguredSandbox } from './config';
import {
  codexIndexEntryToSession,
  codexSummaryToSession,
  findCodexTranscript,
  mapCodexHistoryEvents,
  readCodexIndex,
  readCodexTranscriptSummaries,
  readJsonlFile,
} from './history';
import { CODEX_PLAN_ID, codexPlanEntries, execToolCall, fileChangeToolCall } from './tool-view';
import { diffContentFromUnified } from './unified-diff';

interface CodexSkillCommand extends AgentCommand {
  path: string;
}

type CodexTurnInput =
  | { type: 'text'; text: string; text_elements: never[] }
  | { type: 'image'; url: string }
  | { type: 'skill'; name: string; path: string };

const COMPACT_COMMAND: AgentCommand = {
  name: 'compact',
  description: 'Summarize conversation to prevent hitting the context limit',
};

/** Map the app-server's `skills/list` response onto the normalized command catalog: only enabled
 * skills are invokable, and duplicate names resolve to the first provider result, like the TUI's
 * name-based mention lookup. */
export function codexSkillCommands(response: unknown): CodexSkillCommand[] {
  if (!isRecord(response) || !Array.isArray(response.data)) return [];
  const commands = new Map<string, CodexSkillCommand>();
  for (const entry of response.data) {
    if (!isRecord(entry) || !Array.isArray(entry.skills)) continue;
    for (const skill of entry.skills) {
      if (!isRecord(skill) || skill.enabled !== true) continue;
      const name = stringField(skill, 'name');
      const path = stringField(skill, 'path');
      if (!name || !path || commands.has(name)) continue;
      const interfaceMetadata = recordField(skill, 'interface');
      commands.set(name, {
        name,
        description:
          stringField(skill, 'description') ??
          (interfaceMetadata && stringField(interfaceMetadata, 'shortDescription')) ??
          stringField(skill, 'shortDescription'),
        path,
      });
    }
  }
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface CodexModelDefaults {
  defaultModel: string | undefined;
  efforts: Map<string, EffortLevel>;
}

/** Read model-specific defaults from `model/list` without pinning them as thread/turn overrides.
 * The response is an external JSON-RPC boundary, so accept only the verified fields. */
function codexModelDefaults(response: unknown): CodexModelDefaults {
  const defaults: CodexModelDefaults = { defaultModel: undefined, efforts: new Map() };
  if (!isRecord(response) || !Array.isArray(response.data)) return defaults;
  for (const candidate of response.data) {
    if (!isRecord(candidate)) continue;
    const model = stringField(candidate, 'model') ?? stringField(candidate, 'id');
    if (!model) continue;
    const effort = EffortLevelSchema.safeParse(candidate.defaultReasoningEffort);
    if (effort.success) defaults.efforts.set(model, effort.data);
    if (candidate.isDefault === true) defaults.defaultModel = model;
  }
  return defaults;
}

/** The slice of `CodexAppServer` the adapter drives — narrow so a test fake can satisfy it
 * structurally (the class's private fields would otherwise force a top-type cast). */
export type CodexServerHandle = Pick<CodexAppServer, 'request' | 'setRequestHandler' | 'close'>;

const CODEX_AUTH_FAILED_MESSAGE = 'Codex authentication failed — sign in to your ChatGPT account';

/** Whether an app-server `error` notification reports the 401 of a signed-out/expired login. The
 * structured status (`codexErrorInfo.responseStreamDisconnected.httpStatusCode`) rides only the
 * mid-retry notifications; the final no-retry error leaves the 401 in prose — match both
 * (verified live on codex-cli 0.144.1). */
function isCodexAuthError(error: Record<string, unknown>): boolean {
  const info = recordField(error, 'codexErrorInfo');
  const disconnected = info && recordField(info, 'responseStreamDisconnected');
  if (disconnected && numberField(disconnected, 'httpStatusCode') === 401) return true;
  const prose = `${stringField(error, 'message') ?? ''}\n${stringField(error, 'additionalDetails') ?? ''}`;
  return prose.includes('401 Unauthorized');
}

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/**
 * The approval-policy axis codex advertises — the shared ids (see `ApprovalPolicyIdSchema`)
 * translated onto codex's `approval_policy` + sandbox pair. Unlike claude-code, codex's plan mode
 * is a workflow mode (the `set-mode` axis), so only the three permission tiers ride this channel.
 */
const APPROVAL_POLICIES = [
  {
    policyId: 'default',
    name: 'Ask permissions',
    description: "Ask before running commands outside codex's safe list.",
  },
  {
    policyId: 'acceptEdits',
    name: 'Sandboxed auto',
    description: 'Work autonomously inside the workspace sandbox; ask only to escalate.',
  },
  {
    policyId: 'bypassPermissions',
    name: 'Full access',
    description: 'No sandbox and no approval prompts in this workspace.',
  },
] as const satisfies readonly ApprovalPolicy[];

type CodexPolicyId = (typeof APPROVAL_POLICIES)[number]['policyId'];

/** codex's launch parameters per policy. `acceptEdits` is the initial tier — codex's conventional
 * interactive setup and this adapter's pre-axis behavior. `never` under full access: with the
 * sandbox off nothing is blocked, so nothing needs asking. */
const POLICY_PRESETS: Record<CodexPolicyId, { approvalPolicy: string; sandboxMode: string }> = {
  default: { approvalPolicy: 'untrusted', sandboxMode: 'workspace-write' },
  acceptEdits: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' },
  bypassPermissions: { approvalPolicy: 'never', sandboxMode: 'danger-full-access' },
};
const INITIAL_POLICY_ID: CodexPolicyId = 'acceptEdits';

function isCodexPolicyId(id: string): id is CodexPolicyId {
  return id in POLICY_PRESETS;
}

/** `turn/start` takes the full SandboxPolicy object (unlike `thread/start`'s SandboxMode string),
 * and a turn override replaces the thread policy wholesale — the writable roots must ride too. */
function sandboxPolicyFor(policyId: CodexPolicyId, writableRoots: string[]): unknown {
  if (POLICY_PRESETS[policyId].sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' };
  }
  return {
    type: 'workspaceWrite',
    writableRoots,
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

/**
 * `thread/start` `config` dotted-key overrides for MCP servers — the same override channel as
 * `sandbox_workspace_write.writable_roots`. HTTP servers ride codex's streamable-HTTP MCP client,
 * which sits behind `experimental_use_rmcp_client`. Header forwarding has no known config key, so
 * a headered HTTP server is rejected loudly instead of silently connecting unauthenticated.
 */
export function codexMcpConfigOverrides(
  servers: StartOptions['mcpServers'],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!servers?.length) return out;
  let hasHttp = false;
  for (const server of servers) {
    const prefix = `mcp_servers.${server.name}`;
    if (server.type === 'http') {
      if (server.headers && !isObjectEmpty(server.headers)) {
        throw new Error(`codex: MCP server ${server.name}: HTTP headers are not supported`);
      }
      hasHttp = true;
      out[`${prefix}.url`] = server.url;
    } else {
      out[`${prefix}.command`] = server.command;
      if (server.args) out[`${prefix}.args`] = server.args;
      if (server.env) out[`${prefix}.env`] = server.env;
    }
  }
  if (hasHttp) out.experimental_use_rmcp_client = true;
  return out;
}

/** Map an app-server item status (`inProgress`/`completed`/`failed`/`declined`) to ours;
 * `declined` (approval denied) lands on `failed`, same as claude-code's denied tool_result. */
export function mapCodexItemStatus(status: string | undefined): ToolCallStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'declined':
      return 'failed';
    default:
      return 'in_progress';
  }
}

/** Map a `thread/tokenUsage/updated` breakdown to our TokenUsage. */
export function mapCodexTokenUsage(breakdown: Record<string, unknown>): TokenUsage {
  return {
    inputTokens: numberField(breakdown, 'inputTokens'),
    outputTokens: numberField(breakdown, 'outputTokens'),
    cacheReadTokens: numberField(breakdown, 'cachedInputTokens'),
  };
}

/** Map a permission outcome to the app-server approval decision enum. */
export function decisionFromOutcome(
  outcome: PermissionOutcome,
): 'accept' | 'acceptForSession' | 'decline' | 'cancel' {
  if (outcome.outcome !== 'selected') return 'cancel';
  if (outcome.optionId === 'allow') return 'accept';
  if (outcome.optionId === 'allow_always') return 'acceptForSession';
  return 'decline';
}

/**
 * Codex adapter — drives `codex app-server` (line-delimited JSON-RPC over stdio, the protocol
 * behind the official VS Code extension) instead of `@openai/codex-sdk`. One persistent process
 * carries the whole session: prompts are `turn/start` calls on a single thread, approvals are
 * server→client requests answered through the shared permission round-trip, and model/effort
 * switches ride the next `turn/start` (nothing can alter an in-flight turn). History (list/read)
 * stays on direct rollout-JSONL reads, independent of the live process.
 */
export class CodexAdapter extends BaseAgentAdapter {
  readonly kind = 'codex' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private server: CodexServerHandle | null = null;
  /** Bumped when a server retires/crashes and when a new one spawns: a dead child's buffered
   * stdout (and late exit alarm) carries the old generation and is dropped at the callback gate. */
  private serverGeneration = 0;
  /** In-flight spawn+thread-open, shared by concurrent callers so two prompts racing into a dead
   * session cannot double-spawn app-server processes. */
  private starting: Promise<void> | null = null;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  /** Frames between sending `turn/start` and its reply — while > 0, prompts queue. A COUNT, not a
   * boolean: `turn/completed` can precede the `turn/start` reply, so a drained-queue prompt
   * overlaps the settled frame, whose cleanup must not drop the newer frame's guard. */
  private turnStartsInFlight = 0;
  /** A cancel that arrived inside the turn-start window, before the turn id was known; honored
   * by `activateTurn` the moment the id lands instead of being silently dropped. */
  private cancelRequested = false;
  /** True while a fresh thread's session-ref announcement is deferred to its first turn. */
  private holdSessionRef = false;
  /** A turn id that already completed; a late `turn/start` response for it must not re-activate. */
  private lastCompletedTurnId: string | null = null;
  /** Prompt/skill inputs received while a turn is running; drained one per `turn/completed`. */
  private pendingTurnInputs: CodexTurnInput[][] = [];
  /** Enabled skills from the latest `skills/list`, keyed by the normalized command name. */
  private readonly skillCommands = new Map<string, CodexSkillCommand>();
  /** Monotonic refresh id: a slow stale `skills/list` response must not overwrite a newer push. */
  private skillsRefreshGeneration = 0;
  /** Thread id to resume at the next spawn — set by `resumeHistory`, and re-armed after an
   * unexpected app-server exit so the next prompt continues the same conversation. */
  private resumeFrom: string | undefined;
  /** Model/effort for the next `turn/start`; `turn/start` overrides stick for subsequent turns. */
  private model: string | undefined;
  private effort: EffortLevel | undefined;
  /** Provider defaults keyed by model, refreshed from `model/list` for effective-effort fallback. */
  private modelDefaultEfforts = new Map<string, EffortLevel>();
  /** Active approval/sandbox tier; switches ride the next `turn/start` like model/effort. */
  private policyId: CodexPolicyId = INITIAL_POLICY_ID;
  /** True once the user explicitly picked a tier this session; only then may a preset override
   * a sandbox the user configured in config.toml. */
  private policyExplicit = false;
  /** Sandbox from `~/.codex/config.toml`, re-read at each thread open. Until the tier is an
   * explicit pick, thread/turn requests omit their sandbox override so codex's own config
   * resolution wins (never silently loosen a stricter choice like read-only); the preset's
   * approval posture still rides — approvals are answerable, so `on-request` cannot strand a turn. */
  private configuredSandbox: CodexSandboxMode | undefined;
  /** Streamed text length per item id: converts `item/completed` full texts into the missing
   * remainder (delta backstop), and suppresses re-emitting reasoning that already streamed. */
  private readonly streamedTextLen = new Map<string, number>();
  /** The contextCompaction item announced by item/started but not yet settled by item/completed.
   * Teardown settles it so an interrupted turn never strands a live "compacting…" row. */
  private pendingCompactionId: string | null = null;
  /** Latched on the first 401; cleared when a fresh server spawns. The process caches credentials
   * for its whole lifetime (verified live — an `auth.json` written after spawn is never re-read),
   * so the flag both dedupes the retry storm's banners and marks this server unrecoverable in place. */
  private authFailed = false;

  protected async onStart(opts: StartOptions): Promise<void> {
    this.model = opts.model ?? undefined;
    // openThread reflects the app-server's effective model after thread/start accepts or corrects
    // the requested override; the request itself is not provider confirmation.
    await this.ensureThread();
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
    try {
      await this.start(startOpts);
    } finally {
      this.resumeFrom = undefined;
    }
  }

  override async listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    const offset = cursorOffset(opts?.cursor);
    const limit = boundedLimit(opts?.limit, 50, 200);
    const index = await readCodexIndex();
    const summaries = await readCodexTranscriptSummaries(index);
    const knownIds = new Set(summaries.map((summary) => summary.id));
    const indexOnly = [...index.values()].filter((entry) => !knownIds.has(entry.id));
    const sessions = [
      ...summaries.map(codexSummaryToSession),
      ...indexOnly.map(codexIndexEntryToSession),
    ]
      .filter((session) => !opts?.cwd || session.cwd === opts.cwd)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return {
      sessions: sessions.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, sessions.length, limit),
    };
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const summary = await findCodexTranscript(opts.historyId);
    if (!summary?.path) throw new Error(`codex: history '${opts.historyId}' was not found`);
    const rows = await readJsonlFile(summary.path);
    const events = mapCodexHistoryEvents(opts.historyId, rows);
    const page = sliceHistoryEventPage(events, offset, limit);
    return {
      session: codexSummaryToSession(summary),
      events: page.events,
      cursor: page.cursor,
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    await this.ensureThread();
    // `turn/start`'s image item shape ({type:'image', url:'data:<mime>;base64,<data>'}) was
    // live-verified against codex app-server 0.144.1; nothing documents it (codex has no .d.ts) —
    // verify again if the app-server pin moves.
    const input: CodexTurnInput[] = [];
    for (const block of content) {
      if (block.type === 'text') {
        const previous = input.at(-1);
        if (previous?.type === 'text') previous.text += `\n${block.text}`;
        else input.push({ type: 'text', text: block.text, text_elements: [] });
      }
      if (block.type === 'image') {
        input.push({ type: 'image', url: `data:${block.mimeType};base64,${block.data}` });
      }
    }
    await this.submitTurnInput(input);
  }

  /** Codex slash commands are the app-server's manual compaction control or an enabled skill from
   * `skills/list`. Mirror the TUI: a structured `skill` input plus the visible `$name args` text. */
  protected override async onCommand(name: string, args?: string): Promise<void> {
    await this.ensureThread();
    const { server, threadId } = this.liveThread();
    if (name === COMPACT_COMMAND.name) {
      this.emitStatus('running');
      try {
        await server.request('thread/compact/start', { threadId });
      } catch (err) {
        this.teardown();
        this.emitStatus('idle');
        throw err;
      }
      return;
    }
    const skill = this.skillCommands.get(name);
    if (!skill) throw new Error(`codex: unknown slash command '/${name}'`);
    const text = `$${skill.name}${args ? ` ${args}` : ''}`;
    await this.submitTurnInput([
      { type: 'skill', name: skill.name, path: skill.path },
      { type: 'text', text, text_elements: [] },
    ]);
  }

  private async submitTurnInput(input: CodexTurnInput[]): Promise<void> {
    if (this.activeTurnId !== null || this.turnStartsInFlight > 0) {
      // A turn is running: queue, mirroring claude-code's streaming-input queueing. Drained
      // one input per turn/completed.
      this.pendingTurnInputs.push(input);
      return;
    }
    await this.startTurn(input);
  }

  /** `$`-prefixed shell passthrough — the user's own command, so it bypasses both the sandbox and
   * the approval policy by design, and no approval request ever fires (verified live, codex-cli
   * 0.144.1). `thread/shellCommand` acks with an empty object, then the command runs as a genuine
   * turn on the thread, so the existing notification dispatch does all rendering and settle.
   * turn/completed's status is ALWAYS 'completed' even on a non-zero exit — only the ITEM carries
   * status:'failed'/exitCode, which mapCodexItemStatus folds into a failed tool call. Works with
   * no turn active (a fresh thread's first shell command still releases `holdSessionRef` via
   * turn/started's `activateTurn`); overlapping commands coalesce into the running turn
   * server-side, so this deliberately does not gate on `activeTurnId`/`turnStartsInFlight`. */
  protected override async onShellCommand(command: string): Promise<void> {
    await this.ensureThread();
    const { server, threadId } = this.liveThread();
    // The ack lands before turn/started, but the engine's input gate reads status the moment
    // send() resolves — announce the turn synchronously (base.ts hook contract) or a rapid next
    // submit races the starting shell turn. turn/started's re-emit of running is harmless.
    this.emitStatus('running');
    try {
      await server.request('thread/shellCommand', { threadId, command });
    } catch (err) {
      // An auth retirement rejected this in-flight request and already finalized status — reject
      // the input with the auth story instead of the raw connection-closed fallout.
      if (this.authFailed) throw new Error(CODEX_AUTH_FAILED_MESSAGE, { cause: err });
      // Mirror startTurn's unwind: without the idle emit the engine sees status 'running' on the
      // rejected send() and leaves the session gated busy forever.
      this.teardown();
      this.emitStatus('idle');
      throw err;
    }
  }

  protected override async onCancel(): Promise<void> {
    // Cancel means stop: the in-flight turn is interrupted and queued prompts are dropped
    // (running them after an explicit cancel would surprise).
    this.pendingTurnInputs = [];
    if (!this.server || !this.threadId) return;
    const turnId = this.activeTurnId;
    if (!turnId) {
      // turn/start's round trip is still in flight and the turn id is unknown; arm the cancel so
      // activateTurn interrupts the moment the id lands, instead of letting the turn run on.
      if (this.turnStartsInFlight > 0) this.cancelRequested = true;
      return;
    }
    await this.interruptTurn(turnId);
  }

  private async interruptTurn(turnId: string): Promise<void> {
    const server = this.server;
    const threadId = this.threadId;
    if (!server || !threadId) return;
    try {
      await server.request('turn/interrupt', { threadId, turnId });
      // turn/completed with status 'interrupted' follows and finalizes the turn (stop+idle).
    } catch {
      // The turn may have settled before the interrupt landed; its own completion finalizes.
    }
  }

  /** Record the live turn id (from turn/started or the turn/start response, whichever lands
   * first) and fire any cancel that was armed while the id was still unknown. */
  private activateTurn(turnId: string): void {
    if (turnId === this.lastCompletedTurnId) return;
    this.activeTurnId = turnId;
    // The server has accepted the first turn, so the rollout now contains it: safe to hand
    // clients the history id for transcript seeding (see openThread).
    if (this.holdSessionRef && this.threadId) {
      this.holdSessionRef = false;
      this.emitSessionRef(asHistoryId(this.threadId));
    }
    if (this.cancelRequested) {
      this.cancelRequested = false;
      void this.interruptTurn(turnId);
    }
  }

  /** Model switching: stored and sent on the next `turn/start` (`model` overrides stick for
   * subsequent turns). Codex has no way to alter the turn already in flight. */
  protected override onSetModel(model: string): Promise<void> {
    invariant(this.opts, 'codex: session not started');
    this.opts.model = model;
    this.model = model;
    // Reflect the pick now; it applies from the next turn/start.
    this.emitModel(model);
    return Promise.resolve();
  }

  /** Effort switching, same next-turn channel as the model. Codex accepts low–xhigh;
   * `max`/`ultracode` are claude-code concepts with no codex equivalent. */
  protected override onSetEffort(effort: EffortLevel): Promise<void> {
    if (effort === 'max' || effort === 'ultracode') {
      return Promise.reject(
        new Error(`codex: effort '${effort}' is not supported (codex accepts low through xhigh)`),
      );
    }
    this.effort = effort;
    // Reflect the pick now; it applies from the next turn/start.
    this.emitEffort(effort);
    return Promise.resolve();
  }

  private approvalPolicyState(): ApprovalPolicyState {
    return { availablePolicies: [...APPROVAL_POLICIES], currentPolicyId: this.policyId };
  }

  /** Approval/sandbox switching, same next-turn channel: the pair rides the next `turn/start`
   * (an in-flight turn keeps its policy — the protocol cannot alter it). */
  protected override onSetApprovalPolicy(policyId: string): Promise<void> {
    if (!isCodexPolicyId(policyId)) {
      return Promise.reject(new Error(`codex: unknown approval policy '${policyId}'`));
    }
    this.policyId = policyId;
    this.policyExplicit = true;
    this.emitApprovalPolicy(this.approvalPolicyState());
    return Promise.resolve();
  }

  /** Whether requests may carry a sandbox override — never while an un-picked tier would
   * trample a sandbox the user configured themselves (see `configuredSandbox`). */
  private sandboxOverrideAllowed(): boolean {
    return this.policyExplicit || this.configuredSandbox === undefined;
  }

  protected override onStop(): Promise<void> {
    this.server?.close();
    this.server = null;
    return Promise.resolve();
  }

  /** Spawn the app-server and start (or resume) the thread. Re-entrant: a live server is a no-op,
   * concurrent callers share one in-flight attempt, after a crash the next prompt respawns here. */
  private ensureThread(): Promise<void> {
    if (this.server) return Promise.resolve();
    this.starting ??= this.openThread().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Test seam — the real thing resolves the codex binary and spawns it. Resolution prefers the
   * managed dir / detected user install (CODE-110/114 — packaged apps ship no agent binaries)
   * and falls back to node_modules self-resolution for dev shells and standalone daemons. */
  protected startAppServer(
    opts: Omit<CodexAppServerOptions, 'binaryPath'>,
  ): Promise<CodexServerHandle> {
    const binaryPath = agentRuntimeProber.resolveBinary('codex') ?? resolveCodexBinaryPath();
    return CodexAppServer.start({ ...opts, binaryPath });
  }

  /** Test seam — the real thing reads `~/.codex/config.toml`. */
  protected readConfiguredSandbox(): Promise<CodexSandboxMode | undefined> {
    return codexConfiguredSandbox();
  }

  private async openThread(): Promise<void> {
    const opts = nullthrow(this.opts, 'codex: session not started');
    // Merged over the inherited env by the app-server: CODEX_API_KEY + optional OPENAI_BASE_URL.
    const credentialEnv = codexEnv(readAgentCredential(opts.config));
    this.configuredSandbox = await this.readConfiguredSandbox();
    let server: CodexServerHandle;
    const generation = ++this.serverGeneration;
    try {
      server = await this.startAppServer({
        env: credentialEnv,
        onNotification: (method, params) => {
          if (generation === this.serverGeneration) this.handleNotification(method, params);
        },
        onExit: (_code, stderrTail) => {
          if (generation === this.serverGeneration) this.handleServerExit(stderrTail);
        },
      });
    } catch (err) {
      const message = extractErrorMessage(err) ?? 'codex: app-server failed to start';
      this.emitError(message, 'sdk-unavailable', false);
      throw new Error(message, { cause: err });
    }
    server.setRequestHandler('item/commandExecution/requestApproval', (params) =>
      this.handleApproval(params, 'execute'),
    );
    server.setRequestHandler('item/fileChange/requestApproval', (params) =>
      this.handleApproval(params, 'edit'),
    );
    this.server = server;
    // A fresh process re-read the on-disk credentials — its auth state is unknown again.
    this.authFailed = false;
    const modelDefaultsPromise = this.readModelDefaults(server);
    const resume = this.resumeFrom ?? undefined;
    this.resumeFrom = undefined;
    const preset = POLICY_PRESETS[this.policyId];
    const configOverrides = {
      ...(opts.additionalDirectories?.length && {
        'sandbox_workspace_write.writable_roots': opts.additionalDirectories,
      }),
      ...codexMcpConfigOverrides(opts.mcpServers),
    };
    const params = {
      cwd: opts.cwd,
      model: this.model,
      approvalPolicy: preset.approvalPolicy,
      ...(this.sandboxOverrideAllowed() && { sandbox: preset.sandboxMode }),
      ...(!isObjectEmpty(configOverrides) && { config: configOverrides }),
    };
    // A fresh thread's rollout holds nothing yet: announcing its history id now would trigger the
    // clients' transcript seed read, whose uptoSeq cut can swallow the first prompt. Hold the
    // announcement until the first turn is running; a resumed thread's rollout is complete, so
    // announce immediately. Set before the request: thread/started can outrun the response.
    this.holdSessionRef = !resume;
    try {
      const response = resume
        ? await server.request('thread/resume', { ...params, threadId: resume, excludeTurns: true })
        : await server.request('thread/start', params);
      const modelDefaults = await modelDefaultsPromise;
      this.modelDefaultEfforts = modelDefaults.efforts;
      this.reflectThreadSettings(response, modelDefaults.defaultModel);
      const thread = isRecord(response) ? recordField(response, 'thread') : undefined;
      const threadId = thread ? stringField(thread, 'id') : undefined;
      this.threadId = threadId ?? null;
      if (threadId && !this.holdSessionRef) this.emitSessionRef(asHistoryId(threadId));
      // Advertise the axis so the composer's picker appears with the session's real state.
      this.emitApprovalPolicy(this.approvalPolicyState());
      await this.publishCommands(server);
    } catch (err) {
      // Re-arm the resume point: a transient thread/resume failure must not silently downgrade
      // the next attempt into a brand-new thread that abandons the conversation.
      this.resumeFrom = resume;
      // Retire this generation too — the closed child may still flush buffered stdout.
      this.serverGeneration += 1;
      server.close();
      this.server = null;
      throw err;
    }
  }

  /** Best-effort provider defaults. Older detected app-server builds may lack `model/list`; the
   * thread response can still reflect any explicit configured effort without this catalog. */
  private async readModelDefaults(server: CodexServerHandle): Promise<CodexModelDefaults> {
    try {
      return codexModelDefaults(await server.request('model/list', {}));
    } catch {
      return { defaultModel: undefined, efforts: new Map() };
    }
  }

  /** Reflect the app-server's effective model and effort. A null effort means no override, so the
   * selected model's catalog default is the actual value. An explicit user pick remains pending
   * until `thread/settings/updated` confirms what the next turn accepted. */
  private reflectThreadSettings(response: unknown, fallbackModel?: string): void {
    if (!isRecord(response)) return;
    const model = stringField(response, 'model') ?? fallbackModel;
    if (model) this.emitModel(model);
    if (this.effort !== undefined) return;
    const effort = EffortLevelSchema.safeParse(response.reasoningEffort);
    const effective = effort.success
      ? effort.data
      : model
        ? this.modelDefaultEfforts.get(model)
        : null;
    if (effective) this.emitEffort(effective);
  }

  /** Best-effort full catalog refresh. `skills/changed` invalidates every cached provider path, so
   * refresh failures fail closed to just the local `/compact` control. */
  private async publishCommands(server: CodexServerHandle): Promise<void> {
    const generation = ++this.skillsRefreshGeneration;
    try {
      const response = await server.request('skills/list', {
        cwds: [nullthrow(this.opts, 'codex: session not started').cwd],
        forceReload: false,
      });
      if (this.server !== server || generation !== this.skillsRefreshGeneration) return;
      // LinkCode's provider control wins a name collision, matching Paseo's client-command
      // precedence: `/compact` must always invoke the thread compaction RPC.
      const skills = codexSkillCommands(response).filter(
        (skill) => skill.name !== COMPACT_COMMAND.name,
      );
      this.skillCommands.clear();
      for (const skill of skills) this.skillCommands.set(skill.name, skill);
      this.emitCommands([COMPACT_COMMAND, ...skills.map(({ path: _path, ...command }) => command)]);
    } catch {
      if (this.server === server && generation === this.skillsRefreshGeneration) {
        this.skillCommands.clear();
        this.emitCommands([COMPACT_COMMAND]);
      }
    }
  }

  /** Server+thread after `ensureThread()`, or the clearest rejection when the 401 retirement
   * emptied them in the same tick the input was dispatched (the ensureThread await window). */
  private liveThread(): { server: CodexServerHandle; threadId: string } {
    const server = this.server;
    const threadId = this.threadId;
    if (server && threadId) return { server, threadId };
    throw new Error(this.authFailed ? CODEX_AUTH_FAILED_MESSAGE : 'codex: session not started');
  }

  private async startTurn(input: CodexTurnInput[]): Promise<void> {
    const { server, threadId } = this.liveThread();
    this.turnStartsInFlight += 1;
    this.emitStatus('running');
    try {
      const response = await server.request('turn/start', {
        threadId,
        input,
        ...(this.model !== undefined && { model: this.model }),
        ...(this.effort !== undefined && { effort: this.effort }),
        // Idempotent policy override — this is how a set-approval-policy lands on codex.
        approvalPolicy: POLICY_PRESETS[this.policyId].approvalPolicy,
        ...(this.sandboxOverrideAllowed() && {
          sandboxPolicy: sandboxPolicyFor(this.policyId, this.opts?.additionalDirectories ?? []),
        }),
      });
      // turn/started usually carries the id first; the response is the fallback. A turn that
      // already completed (lastCompletedTurnId) must not be re-activated by a late response.
      const turn = isRecord(response) ? recordField(response, 'turn') : undefined;
      const turnId = turn ? stringField(turn, 'id') : undefined;
      if (turnId && this.activeTurnId === null) this.activateTurn(turnId);
    } catch (err) {
      this.cancelRequested = false;
      // An auth retirement rejects any in-flight turn/start when it closes the server; it already
      // finalized the turn and told the auth story — unwinding again would double-emit idle.
      if (!this.authFailed) {
        this.emitError(extractErrorMessage(err) ?? 'codex: turn failed to start');
        this.teardown();
        this.emitStatus('idle');
      }
    } finally {
      this.turnStartsInFlight -= 1;
    }
  }

  /** The app-server died out from under the session (crash, external kill). Finalize the turn
   * like claude-code's consume() unwind, and arm the next prompt to respawn + resume in place. */
  private handleServerExit(detail: string): void {
    this.emitError(`codex: app-server exited unexpectedly${detail ? ` (${detail})` : ''}`);
    this.finalizeServer();
  }

  /** One auth-coded error per failed server (the engine's login re-probe keys on the code), then
   * retire it: the 401 retry storm (5× websocket + 5× https, ~27 s, verified live) can never
   * succeed against process-cached credentials, so waiting it out only burns time and banners. */
  private handleAuthFailure(): void {
    if (this.authFailed) return;
    this.authFailed = true;
    this.emitError(CODEX_AUTH_FAILED_MESSAGE, AUTH_FAILED_ERROR_CODE, false);
    // Deliberate close(): CodexAppServer suppresses onExit for it, so no exit alarm follows.
    this.server?.close();
    this.finalizeServer();
  }

  /** Shared unwind for a crashed or retired server: finalize the turn and arm the next prompt to
   * respawn + `thread/resume` — the respawn re-reads on-disk credentials (retry-after-login). */
  private finalizeServer(): void {
    // Anything the dead child still flushes to stdout is stale — drop it at the callback gate.
    this.serverGeneration += 1;
    this.server = null;
    this.activeTurnId = null;
    // turnStartsInFlight deliberately untouched: the exit/close already rejected in-flight
    // turn/starts, so each frame's finally releases its own slot — resetting would double-release.
    this.cancelRequested = false;
    this.holdSessionRef = false;
    if (this.pendingTurnInputs.length > 0) {
      // Their send() already resolved into the queue, so an event is the only remaining channel
      // to tell the user those prompts will never run.
      this.emitError(
        `codex: ${this.pendingTurnInputs.length} queued prompt(s) did not run — send them again`,
      );
      this.pendingTurnInputs = [];
    }
    this.resumeFrom = this.threadId ?? this.resumeFrom;
    this.threadId = null;
    this.teardown();
    this.emitStatus('idle');
  }

  private handleNotification(method: string, params: unknown): void {
    if (!isRecord(params)) return;
    switch (method) {
      case 'thread/started': {
        const thread = recordField(params, 'thread');
        const id = thread ? stringField(thread, 'id') : undefined;
        if (id) {
          this.threadId = id;
          // Deferred to the first turn for fresh threads — see openThread.
          if (!this.holdSessionRef) this.emitSessionRef(asHistoryId(id));
        }
        break;
      }
      case 'thread/settings/updated': {
        const settings = recordField(params, 'threadSettings');
        if (!settings) break;
        const model = stringField(settings, 'model');
        if (model) this.emitModel(model);
        const effort = EffortLevelSchema.safeParse(settings.effort);
        const effective = effort.success
          ? effort.data
          : model && this.effort === undefined
            ? this.modelDefaultEfforts.get(model)
            : undefined;
        if (effective) this.emitEffort(effective);
        break;
      }
      case 'turn/started': {
        const turn = recordField(params, 'turn');
        const id = turn ? stringField(turn, 'id') : undefined;
        if (id) this.activateTurn(id);
        this.emitStatus('running');
        break;
      }
      case 'turn/completed': {
        const turn = recordField(params, 'turn');
        if (turn) this.handleTurnCompleted(turn);
        break;
      }
      case 'item/agentMessage/delta': {
        const itemId = stringField(params, 'itemId');
        const delta = stringField(params, 'delta');
        if (itemId && delta) {
          this.emitAssistantText(delta, asMessageId(itemId));
          this.streamedTextLen.set(itemId, (this.streamedTextLen.get(itemId) ?? 0) + delta.length);
        }
        break;
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const itemId = stringField(params, 'itemId');
        const delta = stringField(params, 'delta');
        if (itemId && delta) {
          this.emitThought(delta, asMessageId(itemId));
          this.streamedTextLen.set(itemId, (this.streamedTextLen.get(itemId) ?? 0) + delta.length);
        }
        break;
      }
      case 'item/reasoning/summaryPartAdded': {
        // Mirror the '\n\n' separator the completed item's summary array is joined with, so
        // streamed segments don't merge into one thought and the length backstop stays aligned.
        const itemId = stringField(params, 'itemId');
        if (itemId && (this.streamedTextLen.get(itemId) ?? 0) > 0) {
          this.emitThought('\n\n', asMessageId(itemId));
          this.streamedTextLen.set(itemId, (this.streamedTextLen.get(itemId) ?? 0) + 2);
        }
        break;
      }
      case 'item/started':
      case 'item/completed': {
        const item = recordField(params, 'item');
        if (item) this.handleItem(item, method === 'item/completed');
        break;
      }
      case 'turn/plan/updated': {
        const plan = params.plan;
        if (!Array.isArray(plan)) break;
        this.emit({
          type: 'plan',
          plan: { planId: CODEX_PLAN_ID, entries: codexPlanEntries(plan) },
        });
        break;
      }
      case 'thread/tokenUsage/updated': {
        // `total` (thread-cumulative), not `last`: this fires once per model call and consumers
        // replace usage wholesale — the `last` slice would show only the final sub-call's tokens.
        const tokenUsage = recordField(params, 'tokenUsage');
        const total = tokenUsage ? recordField(tokenUsage, 'total') : undefined;
        if (total) this.emitUsage(mapCodexTokenUsage(total));
        break;
      }
      case 'skills/changed': {
        const server = this.server;
        if (server) {
          this.skillCommands.clear();
          this.emitCommands([COMPACT_COMMAND]);
          void this.publishCommands(server);
        }
        break;
      }
      case 'error': {
        const error = recordField(params, 'error');
        if (error && isCodexAuthError(error)) {
          // Every 401 retry re-reports the same failure; the first one settles it.
          this.handleAuthFailure();
          break;
        }
        const message = error ? stringField(error, 'message') : undefined;
        // Turn-fatal errors also arrive as turn/completed(status failed), which finalizes; this
        // event alone (e.g. a retryable stream hiccup) must not tear the turn down.
        this.emitError(message ?? 'Unknown error');
        break;
      }
      default:
        break;
    }
  }

  private handleTurnCompleted(turn: Record<string, unknown>): void {
    const id = stringField(turn, 'id');
    if (id) this.lastCompletedTurnId = id;
    this.activeTurnId = null;
    this.cancelRequested = false;
    this.streamedTextLen.clear();
    const status = stringField(turn, 'status');
    if (status === 'failed') {
      const error = recordField(turn, 'error');
      this.emitError((error && stringField(error, 'message')) ?? 'Codex returned an error');
    } else if (status === 'interrupted') {
      this.emitStop('cancelled');
    } else {
      this.emitStop('end_turn');
    }
    this.teardown();
    if (this.pendingTurnInputs.length === 0) {
      this.emitStatus('idle');
      return;
    }
    const [next, ...remaining] = this.pendingTurnInputs;
    this.pendingTurnInputs = remaining;
    void this.startTurn(next);
  }

  private handleItem(item: Record<string, unknown>, completed: boolean): void {
    const type = stringField(item, 'type');
    const id = stringField(item, 'id');
    if (!type || !id) return;
    switch (type) {
      case 'agentMessage': {
        // Text streams via deltas; the completed full snapshot corrects a dropped/mutated delta.
        if (!completed) break;
        const text = stringField(item, 'text');
        this.emitAgentMessage(asMessageId(id), text ? [textBlock(text)] : undefined);
        break;
      }
      case 'reasoning': {
        // The provider's public summary is the authoritative completed thought snapshot.
        if (!completed) break;
        const summary = item.summary;
        const text = Array.isArray(summary)
          ? summary.filter((part): part is string => typeof part === 'string').join('\n\n')
          : '';
        if (text) this.emitAgentThought(asMessageId(id), [textBlock(text)]);
        break;
      }
      case 'commandExecution': {
        const toolCall = execToolCall({
          toolCallId: id,
          command: stringField(item, 'command'),
          cwd: stringField(item, 'cwd'),
          status: mapCodexItemStatus(stringField(item, 'status')),
          output: stringField(item, 'aggregatedOutput'),
          rawOutput: numberField(item, 'exitCode'),
        });
        if (!completed) {
          this.emitTool(toolCall);
          break;
        }
        for (const content of toolCall.content) this.appendToolContent(id, content);
        this.emitTool({ ...toolCall, content: undefined });
        break;
      }
      case 'fileChange': {
        const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
        const locations: Array<{ path: string }> = [];
        const content: ToolCallContent[] = [];
        for (const change of changes) {
          const path = stringField(change, 'path');
          if (!path) continue;
          // An update kind can carry a rename: `kind: {type:'update', move_path}` with `path`
          // holding the pre-rename identity. Cite (and label the diff with) the destination.
          const kind = recordField(change, 'kind');
          const movePath = kind ? stringField(kind, 'move_path') : undefined;
          const changeType = kind ? stringField(kind, 'type') : undefined;
          const displayPath = movePath ?? path;
          locations.push({ path: displayPath });
          const diff = stringField(change, 'diff');
          const structuredChange =
            changeType === 'add' || changeType === 'delete'
              ? changeType
              : movePath
                ? 'move'
                : 'modify';
          if (diff) {
            appendArrayInPlace(
              content,
              diffContentFromUnified(displayPath, diff, {
                change: structuredChange,
                oldPath: movePath ? path : undefined,
              }),
            );
          } else {
            content.push({
              type: 'diff',
              change: structuredChange,
              path: displayPath,
              oldPath: movePath ? path : undefined,
            });
          }
        }
        this.emitTool(
          fileChangeToolCall({
            toolCallId: id,
            status: mapCodexItemStatus(stringField(item, 'status')),
            content,
            locations,
          }),
        );
        break;
      }
      case 'mcpToolCall': {
        const server = stringField(item, 'server') ?? 'mcp';
        const tool = stringField(item, 'tool') ?? 'tool';
        this.emitTool({
          toolCallId: id,
          title: `${server}.${tool}`,
          kind: 'other',
          status: mapCodexItemStatus(stringField(item, 'status')),
          content: [],
          rawInput: item.arguments,
          rawOutput: item.result ?? item.error,
        });
        break;
      }
      case 'webSearch': {
        this.emitTool({
          toolCallId: id,
          title: stringField(item, 'query') ?? 'Web search',
          kind: 'fetch',
          status: completed ? 'completed' : 'in_progress',
          content: [],
        });
        break;
      }
      case 'plan': {
        // A plan-proposal message (distinct from the turn/plan/updated step list): plain
        // assistant prose, emitted once on completion (its deltas are not subscribed).
        if (!completed) break;
        const text = stringField(item, 'text');
        if (text) this.emitAgentMessage(asMessageId(id), [textBlock(text)]);
        break;
      }
      case 'contextCompaction': {
        // The item carries only its id (ThreadItem::ContextCompaction — no tokens or summary),
        // so started vs completed is the whole payload; consumers merge by compactionId.
        this.pendingCompactionId = completed ? null : id;
        this.emit({
          type: 'compaction',
          compactionId: id,
          status: completed ? 'completed' : 'in_progress',
        });
        break;
      }
      default:
        break;
    }
  }

  protected override teardown(): void {
    // item/completed can be lost to an interrupt or server death mid-compaction; settle the
    // marker rather than stranding a live "compacting…" row past the turn.
    const pending = this.pendingCompactionId;
    if (pending !== null) {
      this.pendingCompactionId = null;
      this.emit({ type: 'compaction', compactionId: pending, status: 'completed' });
    }
    super.teardown();
  }

  /** Answer an approval request through the shared permission round-trip. The tool card with the
   * same item id was already announced by item/started; the permission card correlates to it. */
  private async handleApproval(
    params: unknown,
    kind: 'execute' | 'edit',
  ): Promise<{ decision: string }> {
    if (!isRecord(params)) return { decision: 'decline' };
    const itemId = stringField(params, 'itemId');
    if (!itemId) return { decision: 'decline' };
    const command = stringField(params, 'command');
    const cwd = stringField(params, 'cwd') ?? this.opts?.cwd;
    const reason = stringField(params, 'reason');
    const title = kind === 'edit' ? 'Apply file changes' : (command ?? 'Run command');
    this.emitTool({
      toolCallId: itemId,
      title,
      kind,
      status: 'in_progress',
      rawInput: { command, cwd, reason },
    });
    const outcome = await this.requestPermission(
      {
        title,
        description: reason,
        subject:
          command && cwd
            ? { type: 'command', command, cwd, toolCallId: itemId }
            : { type: 'tool-call', toolCallId: itemId },
      },
      PERMISSION_OPTIONS,
    );
    return { decision: decisionFromOutcome(outcome) };
  }
}
