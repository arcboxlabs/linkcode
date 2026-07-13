import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { env } from 'node:process';
import type {
  CanUseTool,
  HookCallback,
  PermissionMode,
  PermissionResult,
  Query,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPermissionDeniedMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SessionMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentCommand,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentHistorySession,
  ApprovalPolicy,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  PermissionOption,
  StartOptions,
  StopReason,
  ToolCall,
  ToolCallContent,
} from '@linkcode/schema';
import { EffortLevelSchema, textBlock } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant, nullthrow } from 'foxts/guard';
import { z } from 'zod';
import { AUTH_FAILED_ERROR_CODE } from '../adapter';
import { BaseAgentAdapter } from '../base';
import { claudeCodeEnv, readAgentCredential } from '../credential';
import {
  asHistoryId,
  asMessageId,
  boundedLimit,
  compactRecord,
  cursorFromFetched,
  cursorOffset,
  firstText,
  isRecord,
  numberField,
  textHistoryEvent,
  timestampMs,
} from '../history-util';
import { agentRuntimeProber } from '../probe';
import { contentToText, locationsFromToolInput, toolKindFromName } from '../util';

type StreamEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];
type AssistantSDKMessage = Extract<SDKMessage, { type: 'assistant' }>;
type AssistantMessage = AssistantSDKMessage['message'];
type UserSDKMessage = Extract<SDKMessage, { type: 'user' }>;
type ResultMessage = Extract<SDKMessage, { type: 'result' }>;

/** Claude's subagent-spawning tool: named `Agent` in current CLIs (verified live against the
 * vendored 0.3.x), `Task` in older transcripts — history replay still meets the old name. Exact
 * match on purpose: the shared name-based classifier stays untouched so other adapters (e.g.
 * opencode's lowercase `task`) opt in deliberately rather than by regex accident. */
function claudeToolKind(name: string): ToolCall['kind'] {
  return name === 'Task' || name === 'Agent' ? 'task' : toolKindFromName(name);
}

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/** AskUserQuestion's tool input (the CLI caps questions at 4 and options at 2–4; only what the
 * client renders is required here, so benign vendor additions don't break the parse). */
const ASK_USER_QUESTION_INPUT = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1),
        header: z.string().optional(),
        multiSelect: z.boolean().optional(),
        options: z
          .array(z.object({ label: z.string().min(1), description: z.string().optional() }))
          .min(1),
      }),
    )
    .min(1),
});

/**
 * The approval-policy axis claude-code advertises; ids map 1:1 onto the SDK's `PermissionMode` and
 * names/order match Claude Desktop's own Mode menu. Claude models permission handling and plan as
 * ONE axis, so `plan` rides this channel for claude-code (the generic `set-mode` workflow axis
 * remains for agents like codex where plan is a workflow mode); the composer dedupes the stub
 * workflow entry by id. Only `dontAsk` stays off the menu: its deny-by-default adds nothing over
 * rejecting the asks `default` already raises.
 */
const APPROVAL_POLICIES = [
  {
    policyId: 'default',
    name: 'Ask permissions',
    description: 'Always ask before editing files and running commands.',
  },
  {
    policyId: 'acceptEdits',
    name: 'Accept edits',
    description: 'Auto-approve file edits; still ask for everything else.',
  },
  {
    policyId: 'plan',
    name: 'Plan mode',
    description: 'Read-only research; propose a plan before making changes.',
  },
  {
    policyId: 'auto',
    name: 'Auto mode',
    description: 'A classifier approves routine actions and blocks risky or external ones.',
  },
  {
    policyId: 'bypassPermissions',
    name: 'Bypass permissions',
    description: 'Skip all permission prompts in this workspace.',
  },
] as const satisfies ReadonlyArray<ApprovalPolicy & { policyId: PermissionMode }>;

type ClaudeApprovalPolicyId = (typeof APPROVAL_POLICIES)[number]['policyId'];

/**
 * Resolve `permissions.defaultMode` from Claude settings, same precedence as the CLI
 * (local > project > user). The SDK-driven CLI pins its startup mode to 'default' unless
 * `--permission-mode` is passed — unlike the interactive CLI it does NOT apply the settings
 * default itself (verified empirically against 0.3.179's vendored CLI, including with explicit
 * `settingSources`) — so honoring the user's configured default is on the adapter.
 */
async function settingsDefaultMode(cwd: string): Promise<ClaudeApprovalPolicyId | undefined> {
  const files = [
    path.join(cwd, '.claude', 'settings.local.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(homedir(), '.claude', 'settings.json'),
  ];
  for (const file of files) {
    let mode: unknown;
    try {
      // eslint-disable-next-line no-await-in-loop -- precedence order is inherently sequential
      const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
      mode =
        isRecord(parsed) && isRecord(parsed.permissions)
          ? parsed.permissions.defaultMode
          : undefined;
    } catch {
      continue; // Missing or malformed settings scope — fall through to the next one.
    }
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === mode);
    if (policy) return policy.policyId;
  }
  return undefined;
}

/**
 * The `prompt` fed to a streaming-input `query()`: an `AsyncIterable<SDKUserMessage>` that stays open
 * for the whole session so `onPrompt` can push each new turn into an already-running `Query` instead of
 * spawning a fresh one. Only ever has one consumer (the SDK's own internal read loop).
 */
class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiting: ((message: SDKUserMessage | null) => void) | null = null;
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(message);
    } else {
      this.buffered.push(message);
    }
  }

  /** Ends the iterable, letting the SDK's read loop (and the underlying CLI's stdin) close cleanly. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiting?.(null);
    this.waiting = null;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (this.buffered.length > 0) {
        yield this.buffered.shift()!;
        continue;
      }
      if (this.closed) return;
      // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-message signal
      const next = await new Promise<SDKUserMessage | null>((resolve) => {
        this.waiting = resolve;
      });
      if (next === null) return;
      yield next;
    }
  }
}

/**
 * Map a switchable effort onto Claude's flag-settings keys. `ultracode` is its own boolean key
 * (xhigh plus standing dynamic-workflow orchestration), not an `effortLevel` value; a plain level
 * clears it (`null` drops the key from the flag layer) so the session actually leaves ultracode
 * instead of staying pinned at xhigh by the still-set flag. `max` never comes through here — it
 * can't travel flag-settings at all (see `onSetEffort`).
 */
function effortFlagSettings(
  effort: Exclude<EffortLevel, 'max'>,
): Parameters<Query['applyFlagSettings']>[0] {
  if (effort === 'ultracode') return { ultracode: true };
  return { ultracode: null, effortLevel: effort };
}

/** Map Claude's stop reason to our ACP-aligned StopReason. */
export function mapClaudeStop(reason: string | null): StopReason {
  switch (reason) {
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      // Claude's 'end_turn' / 'tool_use' / 'stop_sequence' all map to a normal end of turn.
      return 'end_turn';
  }
}

/** Normalize a `SlashCommand` onto the cross-agent `AgentCommand` shape: the provider's empty-string
 * `description`/`argumentHint` (no value, not omitted) become `undefined`, and `aliases` — which the
 * normalized shape has no field for — is dropped. */
function mapClaudeCommand(command: SlashCommand): AgentCommand {
  return {
    name: command.name,
    description: command.description || undefined,
    argumentHint: command.argumentHint || undefined,
  };
}

const EMPTY_SUPPLEMENT: ClaudeCompactionSupplement = { records: new Map(), droppedRows: [] };

/**
 * Claude Code adapter — drives `@anthropic-ai/claude-agent-sdk` via `query()` in **streaming input
 * mode**: one persistent `Query` for the whole session, fed through `AsyncMessageQueue` so each new
 * prompt is pushed into the already-running session instead of spawning a fresh `query()` call.
 *
 * This replaced a single-message-per-turn + `resume` design. That was simpler, but the CLI silently
 * ignores a changed `model` option once a session is resumed — verified against the live SDK — so
 * live model switching was impossible. Streaming mode is the only way the SDK exposes mid-session
 * control (`Query#setModel`, `#setPermissionMode`, `#interrupt`); see `onSetModel` / `onCancel` below.
 */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'claude-code' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private q: Query | null = null;
  private inputQueue: AsyncMessageQueue | null = null;
  /** Session id to resume *once*, when the persistent Query starts from saved history — not updated
   * afterwards; the Query carries the conversation itself from there. */
  private resumeFrom: string | undefined;
  /** Suppresses `emitError` for the interrupt-induced stream failure `onCancel` triggers on purpose. */
  private cancelling = false;
  /** The effort the session should run at; applied at `Query` creation and on live switches. */
  private effort: EffortLevel | undefined;
  /** The approval policy the session runs under; applied at `Query` creation and on live switches.
   * `undefined` = the user hasn't picked one — the CLI then resolves its own default (including
   * `permissions.defaultMode` from the user's settings.json), reported back via the init message. */
  private approvalPolicy: ClaudeApprovalPolicyId | undefined;
  /** Provider session id sniffed off the last SDK message — the resume point when an effort
   * transition into/out of `max` forces a process restart (see `onSetEffort`). */
  private lastSessionRef: string | undefined;
  /** Diff content parsed off an Edit/Write announce, keyed by tool_use id. Re-attached at settle
   * because `emitTool`'s merge replaces `content` wholesale — the result text must not wipe the
   * diff. */
  private readonly pendingEditDiffs = new Map<string, ToolCallContent[]>();
  /** The last compaction boundary, awaiting its summary: the swapped-in summary text arrives on a
   * separate user frame identified by the boundary's anchor uuid (see `handleCompactBoundary`). */
  private pendingCompaction: {
    event: Extract<AgentEvent, { type: 'compaction' }>;
    anchorUuid: string | undefined;
  } | null = null;

  protected async onStart(opts: StartOptions): Promise<void> {
    await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    this.approvalPolicy ??= await settingsDefaultMode(opts.cwd);
    this.emitApprovalPolicy(this.approvalPolicyState());
    // Query initialization is also the only authoritative slash-command catalog source. Start the
    // persistent streaming Query with an empty input queue so a fresh session can advertise `/`
    // commands before the user sends its first message.
    await this.createQuery();
  }

  private approvalPolicyState(): ApprovalPolicyState {
    return {
      availablePolicies: [...APPROVAL_POLICIES],
      currentPolicyId: this.approvalPolicy ?? 'default',
    };
  }

  /** Adopt the effective mode the CLI reports (init message) — the authority when the user hasn't
   * picked a policy, since the CLI resolves settings.json's `permissions.defaultMode` itself. */
  private syncApprovalPolicy(mode: PermissionMode): void {
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === mode);
    if (!policy || policy.policyId === this.approvalPolicy) return;
    this.approvalPolicy = policy.policyId;
    this.emitApprovalPolicy(this.approvalPolicyState());
  }

  /** Reflect the served model the CLI reports — the init message and every assistant frame carry it,
   * so the client shows the true model even when the session started without a requested one. Dedup
   * lives in `emitModel`. */
  private syncModel(model: string | undefined): void {
    if (model) this.emitModel(model);
  }

  /** Read-only `Stop` hook that learns the CLI's *resolved* effort (after any per-model downgrade)
   * so a session the user never set an effort on still reflects a real value instead of a
   * placeholder. Skipped once the user picks explicitly: that pick — including `ultracode`/`max`,
   * which this hook's base-level field can't express — is authoritative and emitted by `onSetEffort`.
   * The `effort` field is absent on models without effort support, in which case nothing is emitted. */
  private readonly reflectEffortHook: HookCallback = (input) => {
    if (this.effort === undefined && input.effort?.level) {
      const parsed = EffortLevelSchema.safeParse(input.effort.level);
      if (parsed.success) this.emitEffort(parsed.data);
    }
    return Promise.resolve({ continue: true });
  };

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
    await this.start(startOpts);
  }

  override async listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    const mod = await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    const offset = cursorOffset(opts?.cursor);
    const limit = boundedLimit(opts?.limit, 50, 200);
    const sessions = await mod.listSessions({
      dir: opts?.cwd,
      limit: limit + 1,
      offset,
    });
    return {
      sessions: sessions.slice(0, limit).map(mapClaudeHistorySession),
      cursor: cursorFromFetched(offset, sessions.length, limit),
    };
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const mod = await this.loadSdk(
      '@anthropic-ai/claude-agent-sdk',
      () => import('@anthropic-ai/claude-agent-sdk'),
    );
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const [info, messages, subagentEvents, compactions] = await Promise.all([
      mod.getSessionInfo(opts.historyId),
      mod.getSessionMessages(opts.historyId, {
        limit: limit + 1,
        offset,
      }),
      readSubagentTranscripts(mod, opts.historyId),
      // The supplement only affects the first page — the swapped-in summary is the SDK chain's
      // head row and the dropped rows are prepended before it — so later pages skip the
      // whole-transcript read.
      offset === 0 ? this.readCompactionSupplement(opts.historyId) : EMPTY_SUPPLEMENT,
    ]);
    const historyId = opts.historyId;
    const mapper = createClaudeHistoryEventMapper(historyId, compactions.records);
    const events: AgentHistoryEvent[] = [];
    // Splice each subagent's transcript in right after its spawn announce, so the seeded order
    // matches the live stream and the children land inside the parent's turn (the UI's per-segment
    // partition depends on that). Keyed off the announce (in_progress) only — the later settle
    // re-emits the same tool-call id in a terminal state. Recursive: a subagent's own transcript
    // can announce a further spawn, whose transcript must nest the same way (delete-before-recurse
    // also guards against a malformed self-referential parent id looping forever).
    const pushWithSubagents = (event: AgentHistoryEvent): void => {
      events.push(event);
      if (
        event.event.type === 'tool-call' &&
        event.event.toolCall.kind === 'task' &&
        event.event.toolCall.status === 'in_progress'
      ) {
        const children = subagentEvents.get(event.event.toolCall.toolCallId);
        if (children) {
          subagentEvents.delete(event.event.toolCall.toolCallId);
          for (const child of children) pushWithSubagents(child);
        }
      }
    };
    const page = messages.slice(0, limit);
    // The SDK's chain walk starts at the newest compaction summary, dropping everything logically
    // before it (the reported "history gone" symptom). Prepend those rows — recovered from the raw
    // transcript — ahead of the first page; rows the SDK still returned (the preserved segment,
    // relinked into the post-compaction chain) are deduped by uuid. The dedup window is this page
    // only — safe because the preserved segment sits right after the summary head, well inside it.
    const returned = new Set(page.map((message) => message.uuid));
    const dropped = compactions.droppedRows.filter((row) => !returned.has(row.uuid));
    for (const message of [...dropped, ...page]) {
      for (const event of mapper(message)) pushWithSubagents(event);
    }
    return {
      session: info
        ? mapClaudeHistorySession(info)
        : { historyId, kind: this.kind, title: historyId },
      events,
      cursor: cursorFromFetched(offset, messages.length, limit),
    };
  }

  /** Test seam over the raw transcript probe (see `readClaudeCompactionSupplement`). */
  protected readCompactionSupplement(sessionId: string): Promise<ClaudeCompactionSupplement> {
    return readClaudeCompactionSupplement(sessionId);
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    this.freshSegment();
    this.emitStatus('running');
    const message: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: contentToText(content) },
      parent_tool_use_id: null,
    };
    if (this.inputQueue) {
      // Session already running: hand the SDK's own queued-message support the next turn.
      this.inputQueue.push(message);
      return;
    }
    // A crashed or deliberately rebuilt process is recreated on demand. Normal sessions already
    // own their Query from onStart so the command catalog is available before this first prompt.
    const queue = await this.createQuery();
    queue.push(message);
  }

  private async createQuery(): Promise<AsyncMessageQueue> {
    const opts = nullthrow(this.opts, 'claude-code: session not started');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const queue = new AsyncMessageQueue();
    this.inputQueue = queue;
    // One-time use: the persistent Query carries the conversation itself from here on, so a later
    // Query created after a crash must not resume from this same (by then stale) point again.
    const resume = this.resumeFrom;
    this.resumeFrom = undefined;
    // The SDK has no apiKey/baseURL option; the resolved account reaches the subprocess via `env`.
    // `claudeCodeEnv` spreads the base env (env *replaces* the subprocess environment, so PATH/HOME
    // must survive) and maps the credential to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN /
    // ANTHROPIC_BASE_URL; it returns undefined when the account contributes nothing, so `env` is
    // omitted and the CLI inherits the parent env (the login / OAuth path).
    const credentialEnv = claudeCodeEnv(env, readAgentCredential(opts.config));
    const q = query({
      prompt: queue,
      options: {
        cwd: opts.cwd,
        model: opts.model,
        // Bundled pair staged by the packaged host, else a detected user install (runtime-probe);
        // undefined in dev/standalone daemons, where the SDK resolves its own platform package.
        pathToClaudeCodeExecutable: agentRuntimeProber.resolveBinary('claude-code'),
        // `options.effort` becomes the CLI's `--effort` flag, which outranks the flag-settings
        // layer for the process's whole lifetime — passing it would pin the level and turn every
        // later applyFlagSettings switch into a silent no-op. Only `max` goes in here (the
        // flag-settings key rejects it, so the startup flag is its only way in); the other levels
        // apply through the switchable channel right after creation.
        effort: this.effort === 'max' ? 'max' : undefined,
        includePartialMessages: true,
        // Forward subagent text/thinking (tool_use/tool_result already flow by default) so the
        // client can render the nested transcript; all subagent frames carry parent_tool_use_id.
        forwardSubagentText: true,
        // Read-only Stop hook: learns the resolved effort level so a session the user never set an
        // effort on reflects a real value instead of a placeholder (see `reflectEffortHook`).
        hooks: { Stop: [{ hooks: [this.reflectEffortHook] }] },
        canUseTool: this.canUseTool,
        // Resolved in onStart from settings.json `permissions.defaultMode` (see settingsDefaultMode)
        // — the SDK-driven CLI does not apply that setting itself. `undefined` only when neither the
        // user nor settings picked one, in which case the CLI starts in its 'default' mode.
        permissionMode: this.approvalPolicy,
        // Gate flag only — the effective mode stays `permissionMode` above. It must be set at
        // startup for a later live switch to 'bypassPermissions' to be accepted at all.
        allowDangerouslySkipPermissions: true,
        resume,
        additionalDirectories: opts.additionalDirectories,
        ...(credentialEnv && { env: credentialEnv }),
      },
    });
    this.q = q;
    void this.consume(q);
    // Catalog discovery is optional and may wait on CLI initialization indefinitely. Do not hold
    // session.start behind it; publish whenever the snapshot becomes available.
    void this.publishCommands(q);
    if (this.effort !== undefined && this.effort !== 'max') {
      try {
        await q.applyFlagSettings(effortFlagSettings(this.effort));
      } catch (err) {
        // A stored level the CLI rejects (ultracode without dynamic workflows enabled is the
        // known case) must not fail the prompt or wedge every later one on the same rejection:
        // drop it, report it on the session, and let the turn run at the CLI's default level.
        this.effort = undefined;
        this.emitError(extractErrorMessage(err) ?? 'claude-code: effort switch rejected');
      }
    }
    return queue;
  }

  /** Runs for the whole session — not per turn — dispatching every message the persistent `Query`
   * emits across every prompt pushed into `inputQueue`. Only returns when the underlying process
   * exits (crash, `close()`, or the CLI quitting on its own). */
  private async consume(q: Query): Promise<void> {
    try {
      for await (const msg of q) this.handleMessage(msg);
    } catch (err) {
      if (this.cancelling) this.cancelling = false;
      else this.emitError(extractErrorMessage(err) ?? 'Unknown error');
    }
    // Guard against clobbering a newer Query: if onPrompt already replaced this.q while this call
    // was unwinding, only this call's own q/inputQueue should be torn down here.
    if (this.q === q) {
      this.q = null;
      this.inputQueue = null;
    }
    // The process is gone; finalize anything a mid-flight turn left dangling.
    this.teardown();
    this.emitStatus('idle');
  }

  /** `supportedCommands()` is a snapshot captured at Query init — not updated afterwards on its
   * own — so this fires once per Query to seed the catalog; later provider-side changes arrive
   * via the `commands_changed` push (see `handleMessage`). Failure is non-fatal: a command
   * catalog's absence IS the capability signal (see `AgentEvent.available-commands-update`), so a
   * transient failure here must not surface as a session error — it just leaves the client with
   * no command menu until (if ever) a `commands_changed` push arrives. */
  private async publishCommands(q: Query): Promise<void> {
    try {
      const commands = await q.supportedCommands();
      this.emitCommands(commands.map(mapClaudeCommand));
    } catch {
      // Dropped on purpose — see above.
    }
  }

  protected override async onCancel(): Promise<void> {
    this.cancelling = true;
    try {
      await this.q?.interrupt();
    } catch {
      // Nothing was in flight, so no result/error will follow to consume the flag — clear it now,
      // or a later unrelated error would be wrongly swallowed as if it were this cancel's fallout.
      this.cancelling = false;
    }
    // interrupt() stops the current turn's generation but doesn't guarantee a matching `result`
    // message, so finalize here too; teardown()/emitStatus('idle') are idempotent if one does follow.
    this.teardown();
    this.emitStatus('idle');
  }

  protected override onStop(): Promise<void> {
    this.q?.close();
    this.inputQueue?.close();
    return Promise.resolve();
  }

  /** Real live model switch via the persistent `Query`'s `setModel()` (streaming-input-mode-only
   * control request) — the single-message + `resume` design this replaced could not do this: the CLI
   * ignores a changed `model` option once a session is resumed. */
  protected override async onSetModel(model: string): Promise<void> {
    if (this.q) {
      await this.q.setModel(model);
    } else {
      invariant(this.opts, 'claude-code: session not started');
      this.opts.model = model;
    }
    // Reflect the pick immediately (the CLI accepted it, or it will apply at the next Query
    // creation); the served id off the next assistant frame reconciles it via `syncModel`.
    this.emitModel(model);
  }

  /** Live switch rides the streaming-input control request `Query#setPermissionMode`. The new state
   * reflects only after the CLI accepted the switch, so a rejected one (e.g. auto mode unavailable
   * for the account) leaves the previous policy shown. */
  protected override async onSetApprovalPolicy(policyId: string): Promise<void> {
    const policy = APPROVAL_POLICIES.find((p) => p.policyId === policyId);
    if (!policy) throw new Error(`claude-code: unknown approval policy: ${policyId}`);
    if (this.q) await this.q.setPermissionMode(policy.policyId);
    this.approvalPolicy = policy.policyId;
    this.emitApprovalPolicy(this.approvalPolicyState());
  }

  /** Effort switching has two channels. low–xhigh and `ultracode` switch live via the flag-settings
   * control request (`Query#applyFlagSettings`) — the same layer the CLI's `/effort` writes; see
   * `effortFlagSettings` for how each maps onto the `effortLevel` / `ultracode` keys. `max` can't
   * travel that channel (the key rejects it); its only way in is the `--effort` startup flag,
   * which in turn outranks flag-settings for the process's whole lifetime. So any transition into
   * or out of `max` closes the live process and lets the next prompt rebuild the `Query` — resuming
   * the conversation in place via the session id sniffed off the last SDK message. */
  protected override async onSetEffort(effort: EffortLevel): Promise<void> {
    const previous = this.effort;
    // Re-picking the current level is a no-op — it must not restart a live `max` process.
    if (effort === previous) return;
    if (!this.q) {
      this.effort = effort; // No process yet; onPrompt's Query creation applies it.
      this.emitEffort(effort);
      return;
    }
    if (effort !== 'max' && previous !== 'max') {
      await this.q.applyFlagSettings(effortFlagSettings(effort));
      // Committed only after the CLI accepted the switch: a rejected one (ultracode without
      // dynamic workflows enabled) must not linger and get replayed onto a later rebuilt Query.
      this.effort = effort;
      this.emitEffort(effort);
      return;
    }
    this.effort = effort;
    this.emitEffort(effort);
    // Detach before closing so a prompt racing the async consume() unwind creates the new Query
    // instead of pushing into the closed queue; consume()'s self-guard then skips its own cleanup.
    const q = this.q;
    const queue = this.inputQueue;
    this.q = null;
    this.inputQueue = null;
    // If the process died before any message carried a session id there is nothing to resume;
    // the rebuilt Query then simply starts fresh, keeping the same Link Code session.
    this.resumeFrom = this.lastSessionRef;
    q.close();
    queue?.close();
  }

  /** Invoking a command is pushing a plain user message through the existing prompt path: the
   * vendored CLI parses a leading "/" on every user message even in streaming-input mode (verified
   * against the vendored binary), so there is no separate "run this command" control request — a
   * command's status/settle rides the normal turn lifecycle exactly like a typed prompt. */
  protected override onCommand(name: string, args?: string): Promise<void> {
    const text = `/${name}${args ? ` ${args}` : ''}`;
    return this.onPrompt([textBlock(text)]);
  }

  /** A cancelled/failed turn never delivers the matching tool_results; drop their stashed diffs.
   * A compaction's summary frame also never outlives its turn — drop a stale boundary stash so
   * the summary match can't fire against an unrelated later frame. */
  protected override teardown(): void {
    this.pendingEditDiffs.clear();
    this.pendingCompaction = null;
    super.teardown();
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    if (toolName === 'AskUserQuestion') {
      const questions = ASK_USER_QUESTION_INPUT.safeParse(input);
      // A parse failure means the pinned CLI's tool shape drifted; degrade to the generic
      // allow/deny ask (allow then executes with empty answers) instead of failing the turn.
      if (questions.success) {
        return this.askUserQuestion(questions.data.questions, input, options.toolUseID);
      }
    }
    const outcome = await this.requestPermission(
      {
        toolCallId: options.toolUseID,
        title: options.title ?? toolName,
        kind: claudeToolKind(toolName),
        rawInput: input,
      },
      PERMISSION_OPTIONS,
    );
    const allowed =
      outcome.outcome === 'selected' &&
      (outcome.optionId === 'allow' || outcome.optionId === 'allow_always');
    if (allowed) return { behavior: 'allow', updatedInput: input } satisfies PermissionResult;
    return { behavior: 'deny', message: 'Denied by the user' } satisfies PermissionResult;
  };

  /** AskUserQuestion executes with whatever answers the host writes into its input: the CLI's
   * `checkPermissions` always asks, and an allow that carries no `answers` "succeeds" with every
   * question reported as unanswered. So the ask surfaces as a structured question card, and the
   * user's picks are folded back into `updatedInput.answers` keyed by the question's own text
   * (the CLI's answer-record key; multi-select and free-text answers both ride the same record,
   * multi-select joined with ', ' per the tool's output contract). */
  private async askUserQuestion(
    questions: z.infer<typeof ASK_USER_QUESTION_INPUT>['questions'],
    input: Record<string, unknown>,
    toolUseID: string,
  ): Promise<PermissionResult> {
    const outcome = await this.requestQuestion(
      {
        toolCallId: toolUseID,
        title: 'AskUserQuestion',
        kind: claudeToolKind('AskUserQuestion'),
        rawInput: input,
      },
      questions.map((question, qi) => ({
        questionId: `q${qi}`,
        prompt: question.question,
        header: question.header,
        multiSelect: question.multiSelect ?? false,
        options: question.options.map((option, oi) => ({
          optionId: `o${oi}`,
          label: option.label,
          description: option.description,
        })),
      })),
    );
    if (outcome.outcome === 'cancelled') {
      return { behavior: 'deny', message: 'User declined to answer questions' };
    }
    const byQuestionId = new Map(outcome.answers.map((answer) => [answer.questionId, answer]));
    const answers: Record<string, string> = {};
    for (const [qi, question] of questions.entries()) {
      const answer = byQuestionId.get(`q${qi}`);
      if (!answer) continue;
      const selected = new Set(answer.selectedOptionIds);
      const labels: string[] = [];
      for (const [oi, option] of question.options.entries()) {
        if (selected.has(`o${oi}`)) labels.push(option.label);
      }
      const value = answer.customText?.trim() || labels.join(', ');
      if (value) answers[question.question] = value;
    }
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  protected handleMessage(msg: SDKMessage): void {
    // Every SDK message carries the CLI's session id — the provider-local history id this live run
    // writes to. Sniffed before the replay guard so a resumed session binds immediately.
    if (typeof msg.session_id === 'string' && msg.session_id.length > 0) {
      this.lastSessionRef = msg.session_id;
      this.emitSessionRef(asHistoryId(msg.session_id));
    }
    // The compaction summary rides the stream as an isReplay-flagged user frame right after the
    // boundary (verified live against 0.3.179), so it must be caught before the replay guard
    // below silently drops it.
    if (msg.type === 'user' && this.isCompactionSummary(msg)) {
      const compaction = nullthrow(this.pendingCompaction, 'checked by isCompactionSummary');
      const summary = plainTextContent(msg.message.content);
      if (summary) this.emit({ ...compaction.event, summary });
      this.pendingCompaction = null;
      return;
    }
    // A history-resumed session (see resumeFrom) replays prior turns as `isReplay` frames (historical
    // text + tool_results) right after the Query is created. Skip them: re-emitting as live events
    // would flood the stream and pollute the tool-call snapshot map.
    if ('isReplay' in msg) return;
    switch (msg.type) {
      case 'stream_event':
        this.handleStreamEvent(msg.event, msg.parent_tool_use_id);
        break;
      case 'assistant':
        this.handleAssistant(msg);
        break;
      case 'user':
        this.handleUser(msg);
        break;
      case 'result':
        this.handleResult(msg);
        break;
      case 'system':
        // task_started/task_updated/task_progress intentionally fall through: a card's state derives
        // entirely from the Task tool_use/tool_result pair; consuming them (task_id ↔ tool_use_id
        // correlation) only pays off once run_in_background tasks are supported.
        // eslint-disable-next-line sukka/unicorn/prefer-switch -- deliberately non-exhaustive (other subtypes are ignored); the switch autofix then trips the error-level default-case rule
        if (msg.subtype === 'permission_denied') this.handlePermissionDenied(msg);
        else if (msg.subtype === 'compact_boundary') this.handleCompactBoundary(msg);
        else if (msg.subtype === 'init') {
          this.syncApprovalPolicy(msg.permissionMode);
          this.syncModel(msg.model);
        } else if (msg.subtype === 'commands_changed') {
          // Fire-and-forget full-replace push (`supportedCommands()` is captured once at init and
          // never reflects mid-session changes) — swap the cached catalog wholesale.
          this.emitCommands(msg.commands.map(mapClaudeCommand));
        } else if (msg.subtype === 'local_command_output') {
          // A local command (e.g. /usage) produces no assistant frame of its own; the SDK's own doc
          // comment says to display it "as assistant-style text in the transcript". Bracket it in
          // its own segment so it never merges with narration on either side of it — the command
          // invocation itself (`onCommand`) rides the normal prompt path and its status/settle
          // comes from the matching `result` frame like any other turn (verified live: a local
          // command still ends in a normal zero-token `result`, not a distinct settle shape).
          this.freshSegment();
          this.emitAssistantText(msg.content, this.messageId);
          this.freshSegment();
        }
        break;
      default:
        break;
    }
  }

  /**
   * A compaction boundary: the CLI summarized earlier turns in place — the session (and its id)
   * continue unchanged; only the model's context was swapped (verified live: `session_id` is
   * identical across the boundary). Announce the marker immediately with the boundary's metadata;
   * the swapped-in summary text follows on a separate user frame whose uuid is the boundary's
   * anchor uuid, and re-emits the same `compactionId` with `summary` attached (consumers merge).
   */
  private handleCompactBoundary(msg: SDKCompactBoundaryMessage): void {
    const meta = msg.compact_metadata;
    const event = {
      type: 'compaction' as const,
      compactionId: msg.uuid,
      trigger: meta.trigger,
      preTokens: meta.pre_tokens,
      postTokens: meta.post_tokens,
    };
    this.pendingCompaction = {
      event,
      anchorUuid: meta.preserved_messages?.anchor_uuid ?? meta.preserved_segment?.anchor_uuid,
    };
    this.emit(event);
  }

  /** The summary user frame belonging to the pending compaction boundary: matched by the anchor
   * uuid, or — when the compaction summarized everything and left no anchor — the next synthetic
   * user frame. Deliberately not a type predicate: its `false` branch must not narrow `user`
   * frames out of `handleMessage`'s union. */
  private isCompactionSummary(msg: Extract<SDKMessage, { type: 'user' }>): boolean {
    if (!this.pendingCompaction) return false;
    const anchor = this.pendingCompaction.anchorUuid;
    if (anchor) return msg.uuid === anchor;
    return msg.isSynthetic === true;
  }

  /** A tool call auto-denied without an interactive ask (auto-mode classifier, deny rule, …) never
   * reaches `canUseTool`; this SDK event is the only carrier of the decider's reason. Settle the
   * announced tool as failed with that reason — the later `is_error` tool_result for the same id
   * says only "denied" and is ignored by `emitTool`'s terminal-state guard anyway. */
  private handlePermissionDenied(msg: SDKPermissionDeniedMessage): void {
    const diff = this.pendingEditDiffs.get(msg.tool_use_id) ?? [];
    this.pendingEditDiffs.delete(msg.tool_use_id);
    const reason = msg.decision_reason ?? msg.message;
    this.emitTool({
      toolCallId: msg.tool_use_id,
      title: msg.tool_name,
      kind: claudeToolKind(msg.tool_name),
      status: 'failed',
      content: [
        ...diff,
        ...(reason ? [{ type: 'content' as const, content: textBlock(reason) }] : []),
      ],
    });
  }

  private handleStreamEvent(event: StreamEvent, parentToolUseId: string | null): void {
    // Subagent narration renders message-level from the forwarded assistant frames
    // (handleSubagentAssistant); consuming its deltas here would render the same text twice.
    if (parentToolUseId) return;
    if (event.type !== 'content_block_delta') return;
    const delta = event.delta;
    if (delta.type === 'text_delta') this.emitAssistantText(delta.text, this.messageId);
    else if (delta.type === 'thinking_delta') this.emitThought(delta.thinking, this.thoughtId);
  }

  private handleAssistant(msg: AssistantSDKMessage): void {
    if (msg.parent_tool_use_id) {
      this.handleSubagentAssistant(msg.message, msg.parent_tool_use_id, msg.uuid);
      return;
    }
    const message = msg.message;
    // Every assistant frame carries the served model — the source of truth for a mid-session switch
    // (`init` fires only at Query creation, so it can't catch a live `setModel`).
    this.syncModel(message.model);
    let calledTool = false;
    for (const block of message.content) {
      if (block.type === 'tool_use') {
        const diff = editDiffContent(block.name, block.input);
        if (diff) this.pendingEditDiffs.set(block.id, diff);
        // Announce the tool the moment Claude requests it; the matching tool_result settles it.
        this.emitTool({
          toolCallId: block.id,
          title: block.name,
          kind: claudeToolKind(block.name),
          status: 'in_progress',
          content: diff,
          rawInput: block.input,
          locations: locationsFromToolInput(block.input),
        });
        calledTool = true;
      }
    }
    // A tool call closes this assistant segment; text Claude streams after the tool_result groups into a
    // fresh bubble rather than merging with the pre-tool narration.
    if (calledTool) this.freshSegment();
  }

  /**
   * A subagent's assistant frame (`parent_tool_use_id` set): its tool calls carry the spawning Task's
   * id, and its text/thinking — forwarded whole via `forwardSubagentText` — render message-level under
   * the frame's own uuid. It never touches the main `messageId`/`thoughtId` cursors and never calls
   * `freshSegment()`, so a subagent running mid-turn cannot break the main agent's streaming bubble.
   * (The uuid doubles as the history mapper's id, so a live turn and a later cold-resume seed converge.)
   */
  private handleSubagentAssistant(message: AssistantMessage, parent: string, uuid: string): void {
    for (const block of message.content) {
      // eslint-disable-next-line sukka/unicorn/prefer-switch -- deliberately non-exhaustive (other block variants are ignored); the switch autofix then trips the error-level default-case rule
      if (block.type === 'tool_use') {
        const diff = editDiffContent(block.name, block.input);
        if (diff) this.pendingEditDiffs.set(block.id, diff);
        this.emitTool({
          toolCallId: block.id,
          parentToolCallId: parent,
          title: block.name,
          kind: claudeToolKind(block.name),
          status: 'in_progress',
          content: diff,
          rawInput: block.input,
          locations: locationsFromToolInput(block.input),
        });
      } else if (block.type === 'text') {
        this.emitAssistantText(block.text, asMessageId(uuid), parent);
      } else if (block.type === 'thinking') {
        this.emitThought(block.thinking, asMessageId(`${uuid}:think`), parent);
      }
    }
  }

  /**
   * Tool results come back on the *user* message (Claude's API pairs every `tool_use` with a
   * `tool_result`). This is also where a denied permission lands: the SDK synthesizes an `is_error`
   * result with "Denied by the user", so the same branch settles success, failure, and deny alike.
   */
  private handleUser(msg: UserSDKMessage): void {
    const content = msg.message.content;
    if (typeof content === 'string') return;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const diff = this.pendingEditDiffs.get(block.tool_use_id) ?? [];
      this.pendingEditDiffs.delete(block.tool_use_id);
      this.emitTool({
        toolCallId: block.tool_use_id,
        // Re-stated on settle so the parent link survives even if the announce was never seen
        // (e.g. it sat beyond a history read's page window). Null for main-agent results.
        parentToolCallId: msg.parent_tool_use_id ?? undefined,
        status: block.is_error === true ? 'failed' : 'completed',
        content: [...diff, ...toolResultContent(block.content)],
        rawOutput: block.content,
      });
    }
  }

  /** A `result` message ends one turn — not the session, which now spans the whole `consume()` loop —
   * so this is where per-turn cleanup happens (unlike the old per-turn `query()` design, where the
   * loop ending *was* the turn ending). */
  private handleResult(msg: ResultMessage): void {
    if (msg.subtype === 'success') {
      // A 401 comes back as a `success` result carrying `api_error_status` — without this it would be
      // swallowed into an empty end_turn (CODE-75). Surface it as a non-recoverable auth error whose
      // code drives the daemon's login re-probe, rather than emitting usage + a phantom stop.
      if (msg.api_error_status === 401) {
        this.emitError(
          'Claude authentication failed — sign in to Claude',
          AUTH_FAILED_ERROR_CODE,
          false,
        );
        this.teardown();
        this.emitStatus('idle');
        return;
      }
      const usage = isRecord(msg.usage) ? msg.usage : {};
      this.emitUsage({
        inputTokens: numberField(usage, 'input_tokens'),
        outputTokens: numberField(usage, 'output_tokens'),
        cacheReadTokens: numberField(usage, 'cache_read_input_tokens'),
        cacheCreationTokens: numberField(usage, 'cache_creation_input_tokens'),
        totalCostUsd: msg.total_cost_usd,
      });
      this.emitStop(mapClaudeStop(msg.stop_reason));
    } else if (this.cancelling) {
      // This non-success result is the fallout of our own onCancel()'s interrupt(), not a real
      // failure — consume the flag instead of surfacing it as an error.
      this.cancelling = false;
    } else {
      this.emitError('Claude returned an error', undefined, true);
    }
    this.teardown();
    this.emitStatus('idle');
  }
}

/**
 * Claude's file-mutation tools carry the exact patch in their input — Edit as `file_path` /
 * `old_string` / `new_string`, Write as `file_path` / `content` (a whole-file write, so no
 * oldText: the UI renders it as all-added lines). Surface it as structured diff content so the
 * UI renders a diff instead of the raw input JSON. Returns undefined for every other tool
 * (including NotebookEdit, whose input has no old cell source to diff against) and for a
 * malformed input.
 */
function editDiffContent(toolName: string, input: unknown): ToolCallContent[] | undefined {
  if (!isRecord(input)) return undefined;
  if (toolName === 'Edit') {
    const { file_path: path, old_string: oldText, new_string: newText } = input;
    if (typeof path !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
      return undefined;
    }
    return [{ type: 'diff', path, oldText, newText }];
  }
  if (toolName === 'Write') {
    const { file_path: path, content: newText } = input;
    if (typeof path !== 'string' || typeof newText !== 'string') return undefined;
    return [{ type: 'diff', path, newText }];
  }
  return undefined;
}

/** Normalize a tool_result's payload (string or content blocks) into tool-call content. Accepts
 * `unknown` because it also runs over untyped transcript rows, not only live SDK messages. */
function toolResultContent(content: unknown): ToolCallContent[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'content', content: textBlock(content) }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.reduce<ToolCallContent[]>((items, block) => {
    if (
      isRecord(block) &&
      block.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.length > 0
    ) {
      items.push({ type: 'content', content: textBlock(block.text) });
    }
    return items;
  }, []);
}

/** Flatten a user message's payload (string or API content blocks) into plain text — the shape a
 * compaction summary travels in, both live and on disk. */
function plainTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) =>
      isRecord(block) && block.type === 'text' && typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('\n');
}

/** A session id becomes a transcript filename — only uuid-shaped ids are probed on disk. */
const SAFE_SESSION_ID = /^[\w-]+$/;

export interface ClaudeCompactionRecord {
  compactionId: string;
  trigger?: 'manual' | 'auto';
  preTokens?: number;
  postTokens?: number;
}

/** What the raw transcript knows about compactions that the SDK read API loses. */
export interface ClaudeCompactionSupplement {
  /** Swapped-in-summary row uuid → its boundary's record, for the mapper to turn the summary row
   * into a compaction marker instead of a fake user prompt. */
  records: Map<string, ClaudeCompactionRecord>;
  /** The pre-compaction rows `getSessionMessages` drops: its chain walk starts at the newest
   * summary (whose `parentUuid` is null — `logicalParentUuid` is ignored), so everything logically
   * before the last compaction vanishes from the read. In file (= chronological) order; rows the
   * SDK does still return (the preserved segment) are deduped by uuid at read time. */
  droppedRows: SessionMessage[];
}

/**
 * Recover, from raw transcript lines, what the SDK read API strips about compactions (verified
 * against SDK 0.3.179). On disk a compaction is a `system/compact_boundary` row (camelCase
 * `compactMetadata`) followed by an `isCompactSummary:true` user row carrying the swapped-in
 * summary; a boundary claims the next summary row. `getSessionMessages` keeps only
 * type/uuid/session_id/message/parent_tool_use_id/timestamp per row — the boundary's metadata and
 * the summary flag never survive — and its chain reconstruction drops every row logically before
 * the newest summary, so both the marker and the pre-compaction timeline must come from here.
 */
export function buildClaudeCompactionSupplement(
  lines: Iterable<string>,
): ClaudeCompactionSupplement {
  const records = new Map<string, ClaudeCompactionRecord>();
  /** Conversation rows in file order, with the index of the last boundary seen before each. */
  const rows: Array<{ row: SessionMessage; boundariesBefore: number }> = [];
  let boundaries = 0;
  let pending: ClaudeCompactionRecord | null = null;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // Torn/corrupt line (e.g. a write in progress) — skip, like the SDK's own reader.
    }
    if (!isRecord(parsed) || typeof parsed.uuid !== 'string' || parsed.uuid.length === 0) continue;
    const row = parsed;
    const uuid = parsed.uuid;
    if (row.type === 'system' && row.subtype === 'compact_boundary') {
      boundaries += 1;
      const meta = isRecord(row.compactMetadata) ? row.compactMetadata : {};
      pending = {
        compactionId: uuid,
        trigger: meta.trigger === 'manual' || meta.trigger === 'auto' ? meta.trigger : undefined,
        preTokens: numberField(meta, 'preTokens'),
        postTokens: numberField(meta, 'postTokens'),
      };
      continue;
    }
    if (row.type === 'user' && row.isCompactSummary === true) {
      // A summary row with no preceding boundary (torn write) still marks a compaction; it just
      // has no metadata and is keyed by its own uuid. The row also joins the conversation rows:
      // an EARLIER compaction's summary is itself dropped by the SDK's chain walk, and replaying
      // it through the mapper is what puts that compaction's marker back into the timeline.
      records.set(uuid, pending ?? { compactionId: uuid });
      pending = null;
    } else if (row.type !== 'user' && row.type !== 'assistant') continue;
    // Same exclusions as the SDK's own reader: meta rows, sidechains, and teammate rows.
    if (row.isMeta === true || row.isSidechain === true || row.teamName) continue;
    rows.push({
      row: {
        type: row.type,
        uuid,
        session_id: typeof row.sessionId === 'string' ? row.sessionId : '',
        message: row.message,
        parent_tool_use_id: null,
        parent_agent_id: null,
      },
      boundariesBefore: boundaries,
    });
  }
  return {
    records,
    // Only rows before the last boundary are dropped by the SDK's chain walk; the rest of the
    // timeline (summary head onward) comes back from getSessionMessages as usual.
    droppedRows: rows.reduce<SessionMessage[]>((dropped, r) => {
      if (r.boundariesBefore < boundaries) dropped.push(r.row);
      return dropped;
    }, []),
  };
}

/**
 * Locate the session's transcript and build its compaction supplement. `readHistory` carries no
 * cwd, so — mirroring `getSessionMessages` without `dir` — every project dir is probed for
 * `<sessionId>.jsonl` (the id is unique, so at most one probe succeeds). Any failure degrades to
 * an empty supplement: history still reads, just without compaction markers.
 */
async function readClaudeCompactionSupplement(
  sessionId: string,
): Promise<ClaudeCompactionSupplement> {
  // The id becomes a filename — refuse anything that could traverse out of the projects dir.
  if (!SAFE_SESSION_ID.test(sessionId)) return EMPTY_SUPPLEMENT;
  const projectsDir = path.join(homedir(), '.claude', 'projects');
  let dirs: string[];
  try {
    dirs = await readdir(projectsDir);
  } catch {
    return EMPTY_SUPPLEMENT;
  }
  const texts = await Promise.all(
    dirs.map((dir) =>
      readFile(path.join(projectsDir, dir, `${sessionId}.jsonl`), 'utf8').catch(() => null),
    ),
  );
  const text = texts.find((t) => t !== null);
  return text ? buildClaudeCompactionSupplement(text.split('\n')) : EMPTY_SUPPLEMENT;
}

function mapClaudeHistorySession(session: SDKSessionInfo): AgentHistorySession {
  return {
    historyId: asHistoryId(session.sessionId),
    kind: 'claude-code',
    title: firstText(session.customTitle, session.summary, session.firstPrompt),
    cwd: session.cwd,
    createdAt: timestampMs(session.createdAt),
    updatedAt: timestampMs(session.lastModified),
    metadata: compactRecord({
      fileSize: session.fileSize,
      gitBranch: session.gitBranch,
      tag: session.tag,
    }),
  };
}

/**
 * Subagent transcripts live beside the main one (`subagents/agent-{id}.jsonl`) and are not part of
 * `getSessionMessages`. Every row `getSubagentMessages` returns carries `parent_tool_use_id` — the
 * spawning Task/Agent tool_use id (verified against the vendored SDK's on-disk format) — so a plain
 * run through the history mapper reproduces the same parent-linked events the live stream emits.
 * Keyed by that parent id for splicing in after the spawn announce.
 */
async function readSubagentTranscripts(
  mod: typeof import('@anthropic-ai/claude-agent-sdk'),
  sessionId: string,
): Promise<Map<string, AgentHistoryEvent[]>> {
  const agentIds = await mod.listSubagents(sessionId);
  const byParent = new Map<string, AgentHistoryEvent[]>();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const rows = await mod.getSubagentMessages(sessionId, agentId, { limit: 1000 });
      const parent = rows.find((row) => row.parent_tool_use_id !== null)?.parent_tool_use_id;
      if (!parent) return;
      byParent.set(parent, rows.flatMap(createClaudeHistoryEventMapper(asHistoryId(sessionId))));
    }),
  );
  return byParent;
}

/**
 * Stateful per-read mapper: correlates each `tool_use` announce with the `tool_result` that later
 * settles it, replaying the same announce/settle full-snapshot pairs the live path emits — under
 * the provider's `toolu_` ids, so a seeded timeline and live re-emits of the same call converge
 * by id (`buildConversation` replaces tool calls by id) instead of duplicating.
 */
export function createClaudeHistoryEventMapper(
  historyId: AgentHistoryId,
  compactions?: ReadonlyMap<string, ClaudeCompactionRecord>,
): (message: SessionMessage) => AgentHistoryEvent[] {
  const announced = new Map<string, ToolCall>();

  const toolEvent = (toolCall: ToolCall): AgentHistoryEvent => {
    announced.set(toolCall.toolCallId, toolCall);
    return { historyId, itemId: toolCall.toolCallId, event: { type: 'tool-call', toolCall } };
  };

  return (message) => {
    if (message.type !== 'user' && message.type !== 'assistant') return [];
    // A compaction's swapped-in summary is stored as a user row; replaying it as a user prompt
    // would fake a giant user turn (the reported CODE-141 symptom). It becomes the compaction
    // marker instead, placed exactly where the summary sits in the timeline.
    const compaction = message.type === 'user' ? compactions?.get(message.uuid) : undefined;
    if (compaction) {
      const summary = plainTextContent(
        isRecord(message.message) ? message.message.content : undefined,
      );
      return [
        {
          historyId,
          itemId: compaction.compactionId,
          event: { type: 'compaction', ...compaction, ...(summary && { summary }) },
        },
      ];
    }
    const events: AgentHistoryEvent[] = [];
    const blocks = messageContentBlocks(message.message);
    // Subagent transcript rows carry the spawning Task's tool_use id, same as live frames.
    const parent = message.parent_tool_use_id ?? undefined;

    if (message.type === 'assistant') {
      const text = textHistoryEvent(
        historyId,
        'assistant',
        message.uuid,
        message.message,
        undefined,
        parent,
      );
      if (text) events.push(text);
      for (const block of blocks) {
        if (!isToolUseBlock(block)) continue;
        events.push(
          toolEvent({
            toolCallId: block.id,
            parentToolCallId: parent,
            title: block.name,
            kind: claudeToolKind(block.name),
            status: 'in_progress',
            content: editDiffContent(block.name, block.input) ?? [],
            rawInput: block.input,
          }),
        );
      }
      return events;
    }

    const results = blocks.filter((block) => isToolResultBlock(block));
    for (const block of results) {
      const existing = announced.get(block.tool_use_id);
      events.push(
        toolEvent({
          toolCallId: block.tool_use_id,
          parentToolCallId: parent ?? existing?.parentToolCallId,
          // The announce can sit beyond this read's page window; fall back to emitTool's
          // first-sight defaults rather than dropping the settle.
          title: existing?.title ?? block.tool_use_id,
          kind: existing?.kind ?? 'other',
          status: block.is_error === true ? 'failed' : 'completed',
          // Announce-time content is the Edit diff (or empty); keep it ahead of the result text.
          content: [...(existing?.content ?? []), ...toolResultContent(block.content)],
          rawInput: existing?.rawInput,
          rawOutput: block.content,
        }),
      );
    }
    // A subagent's user rows are only tool_results plus its injected prompt — never something the
    // user typed; emitting that prompt would fake a user turn inside the nested transcript.
    if (parent) return events;
    // Tool-result rows are synthetic user messages; only what remains after removing the
    // tool_results is a prompt the user actually typed.
    const promptValue =
      results.length === 0 ? message.message : blocks.filter((block) => !isToolResultBlock(block));
    const text = textHistoryEvent(historyId, 'user', message.uuid, promptValue);
    if (text) events.push(text);
    return events;
  };
}

interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: unknown;
}

interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: unknown;
  content?: unknown;
}

function messageContentBlocks(message: unknown): unknown[] {
  if (!isRecord(message)) return [];
  const content = message.content;
  return Array.isArray(content) ? content : [];
}

function isToolUseBlock(block: unknown): block is ClaudeToolUseBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    block.id.length > 0 &&
    typeof block.name === 'string' &&
    block.name.length > 0
  );
}

function isToolResultBlock(block: unknown): block is ClaudeToolResultBlock {
  return (
    isRecord(block) &&
    block.type === 'tool_result' &&
    typeof block.tool_use_id === 'string' &&
    block.tool_use_id.length > 0
  );
}
