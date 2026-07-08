import type {
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
  PlanEntry,
  StartOptions,
  TokenUsage,
  ToolCallContent,
  ToolCallStatus,
} from '@linkcode/schema';
import { appendArrayInPlace } from 'foxts/append-array-in-place';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant, nullthrow } from 'foxts/guard';
import { BaseAgentAdapter } from '../../base';
import {
  asHistoryId,
  asMessageId,
  boundedLimit,
  cursorFromTotal,
  cursorOffset,
  isRecord,
  numberField,
  recordField,
  stringField,
} from '../../history-util';
import { agentRuntimeProber } from '../../probe';
import { contentToText } from '../../util';
import { CodexAppServer, resolveCodexBinaryPath } from './app-server';
import {
  codexIndexEntryToSession,
  codexSummaryToSession,
  findCodexTranscript,
  mapCodexHistoryEvents,
  readCodexIndex,
  readCodexTranscriptSummaries,
  readJsonlFile,
} from './history';
import { diffContentFromUnified } from './unified-diff';

const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/**
 * The approval-policy axis codex advertises — the shared ids (claude-code's permission-mode
 * names, see `ApprovalPolicyIdSchema`) translated onto codex's `approval_policy` + sandbox pair.
 * Unlike claude-code, codex's plan mode is a workflow mode (the `set-mode` axis), so only the
 * three permission tiers ride this channel.
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

/** codex's launch parameters per policy. `acceptEdits` is the initial tier — sandboxed autonomy
 * with escalation approvals, codex's conventional interactive setup and this adapter's behavior
 * before the axis existed. `never` under full access keeps commands from failing silently only
 * because the sandbox is off too — nothing is blocked, so nothing needs asking. */
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
 * and a turn-level override replaces the thread policy wholesale — so the writable roots must be
 * carried here too or an override would silently drop them. */
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

function mapCodexPlanStatus(status: string | undefined): PlanEntry['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'inProgress') return 'in_progress';
  return 'pending';
}

function textContent(text: string): ToolCallContent[] {
  if (text.length === 0) return [];
  return [{ type: 'content', content: { type: 'text', text } }];
}

/**
 * Codex adapter — drives `codex app-server` (line-delimited JSON-RPC over stdio, the protocol
 * behind the official VS Code extension) instead of `@openai/codex-sdk`. One persistent
 * app-server process carries the whole session: prompts become `turn/start` calls on a single
 * thread, approvals arrive as server→client requests answered through the shared permission
 * round-trip, and model/effort switches ride the next `turn/start` (they cannot alter a turn
 * already in flight — the closest the protocol offers to claude-code's live switching).
 *
 * History (list/read) stays on direct rollout-JSONL reads and is independent of the live process.
 */
export class CodexAdapter extends BaseAgentAdapter {
  readonly kind = 'codex' as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private server: CodexAppServer | null = null;
  /** In-flight spawn+thread-open, shared by concurrent callers so two prompts racing into a dead
   * session cannot double-spawn app-server processes. */
  private starting: Promise<void> | null = null;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  /** Guards the window between sending `turn/start` and learning the turn id, so a second prompt
   * queues instead of racing a second `turn/start` into the same thread. */
  private turnStarting = false;
  /** A cancel that arrived inside the turnStarting window, before the turn id was known; honored
   * by `activateTurn` the moment the id lands instead of being silently dropped. */
  private cancelRequested = false;
  /** True while a fresh thread's session-ref announcement is deferred to its first turn. */
  private holdSessionRef = false;
  /** A turn id that already completed; a late `turn/start` response for it must not re-activate. */
  private lastCompletedTurnId: string | null = null;
  /** Prompts received while a turn is running; drained one per `turn/completed`. */
  private pendingPrompts: ContentBlock[][] = [];
  /** Thread id to resume at the next spawn — set by `resumeHistory`, and re-armed after an
   * unexpected app-server exit so the next prompt continues the same conversation. */
  private resumeFrom: string | undefined;
  /** Model/effort for the next `turn/start`; `turn/start` overrides stick for subsequent turns. */
  private model: string | undefined;
  private effort: EffortLevel | undefined;
  /** Active approval/sandbox tier; switches ride the next `turn/start` like model/effort. */
  private policyId: CodexPolicyId = INITIAL_POLICY_ID;
  /** Streamed text length per item id: converts `item/completed` full texts into the missing
   * remainder (delta backstop), and suppresses re-emitting reasoning that already streamed. */
  private readonly streamedTextLen = new Map<string, number>();

  protected async onStart(opts: StartOptions): Promise<void> {
    this.model = opts.model;
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
    return {
      session: codexSummaryToSession(summary),
      events: events.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, events.length, limit),
    };
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    await this.ensureThread();
    if (this.activeTurnId !== null || this.turnStarting) {
      // A turn is running: queue, mirroring claude-code's streaming-input queueing. Drained
      // one prompt per turn/completed.
      this.pendingPrompts.push(content);
      return;
    }
    await this.startTurn(content);
  }

  protected override async onCancel(): Promise<void> {
    // Cancel means stop: the in-flight turn is interrupted and queued prompts are dropped
    // (running them after an explicit cancel would surprise).
    this.pendingPrompts = [];
    if (!this.server || !this.threadId) return;
    const turnId = this.activeTurnId;
    if (!turnId) {
      // turn/start's round trip is still in flight and the turn id is unknown; arm the cancel so
      // activateTurn interrupts the moment the id lands, instead of letting the turn run on.
      if (this.turnStarting) this.cancelRequested = true;
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
    this.emitApprovalPolicy(this.approvalPolicyState());
    return Promise.resolve();
  }

  protected override onStop(): Promise<void> {
    this.server?.close();
    this.server = null;
    return Promise.resolve();
  }

  /** Spawn the app-server and start (or resume) the session's thread. Re-entrant: a live server
   * makes this a no-op, concurrent callers share one in-flight attempt, and after a crash the
   * next prompt lands here to respawn and resume. */
  private ensureThread(): Promise<void> {
    if (this.server) return Promise.resolve();
    this.starting ??= this.openThread().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async openThread(): Promise<void> {
    const opts = nullthrow(this.opts, 'codex: session not started');
    const apiKey = typeof opts.config?.apiKey === 'string' ? opts.config.apiKey : undefined;
    let server: CodexAppServer;
    try {
      // Managed dir / detected user install first (CODE-110/114 — packaged apps ship no agent
      // binaries), node_modules self-resolution as the dev/standalone fallback.
      const binaryPath = agentRuntimeProber.resolveBinary('codex') ?? resolveCodexBinaryPath();
      server = await CodexAppServer.start({
        binaryPath,
        env: apiKey ? { CODEX_API_KEY: apiKey } : undefined,
        onNotification: (method, params) => this.handleNotification(method, params),
        onExit: (_code, stderrTail) => this.handleServerExit(stderrTail),
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
    const resume = this.resumeFrom ?? undefined;
    this.resumeFrom = undefined;
    const preset = POLICY_PRESETS[this.policyId];
    const params = {
      cwd: opts.cwd,
      model: this.model,
      approvalPolicy: preset.approvalPolicy,
      sandbox: preset.sandboxMode,
      ...(opts.additionalDirectories?.length && {
        config: { 'sandbox_workspace_write.writable_roots': opts.additionalDirectories },
      }),
    };
    // A fresh thread's rollout holds nothing yet: announcing its history id now would trigger
    // clients' transcript seed read before codex persists the first turn, and the seed's
    // uptoSeq cut can then swallow the first prompt (it trusts the snapshot to contain
    // everything up to the cut). Hold the announcement until the first turn is running —
    // matching claude-code, whose session id also only surfaces with the first turn's
    // messages. A resumed thread's rollout is already complete, so announce immediately.
    // Set before the request: the thread/started notification can outrun the response.
    this.holdSessionRef = !resume;
    try {
      const response = resume
        ? await server.request('thread/resume', { ...params, threadId: resume, excludeTurns: true })
        : await server.request('thread/start', params);
      const thread = isRecord(response) ? recordField(response, 'thread') : undefined;
      const threadId = thread ? stringField(thread, 'id') : undefined;
      this.threadId = threadId ?? null;
      if (threadId && !this.holdSessionRef) this.emitSessionRef(asHistoryId(threadId));
      // Advertise the axis so the composer's picker appears with the session's real state.
      this.emitApprovalPolicy(this.approvalPolicyState());
    } catch (err) {
      // Re-arm the resume point: a transient thread/resume failure must not silently downgrade
      // the next attempt into a brand-new thread that abandons the conversation.
      this.resumeFrom = resume;
      server.close();
      this.server = null;
      throw err;
    }
  }

  private async startTurn(content: ContentBlock[]): Promise<void> {
    const server = nullthrow(this.server, 'codex: session not started');
    const threadId = nullthrow(this.threadId, 'codex: thread not started');
    this.turnStarting = true;
    this.emitStatus('running');
    try {
      const response = await server.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: contentToText(content), text_elements: [] }],
        ...(this.model !== undefined && { model: this.model }),
        ...(this.effort !== undefined && { effort: this.effort }),
        // Idempotent policy override — this is how a set-approval-policy lands on codex.
        approvalPolicy: POLICY_PRESETS[this.policyId].approvalPolicy,
        sandboxPolicy: sandboxPolicyFor(this.policyId, this.opts?.additionalDirectories ?? []),
      });
      // turn/started usually carries the id first; the response is the fallback. A turn that
      // already completed (lastCompletedTurnId) must not be re-activated by a late response.
      const turn = isRecord(response) ? recordField(response, 'turn') : undefined;
      const turnId = turn ? stringField(turn, 'id') : undefined;
      if (turnId && this.activeTurnId === null) this.activateTurn(turnId);
    } catch (err) {
      this.cancelRequested = false;
      this.emitError(extractErrorMessage(err) ?? 'codex: turn failed to start');
      this.teardown();
      this.emitStatus('idle');
    } finally {
      this.turnStarting = false;
    }
  }

  /** The app-server died out from under the session (crash, external kill). Finalize the turn
   * like claude-code's consume() unwind, and arm the next prompt to respawn + resume in place. */
  private handleServerExit(detail: string): void {
    this.server = null;
    this.activeTurnId = null;
    this.turnStarting = false;
    this.cancelRequested = false;
    this.holdSessionRef = false;
    this.pendingPrompts = [];
    this.resumeFrom = this.threadId ?? this.resumeFrom;
    this.threadId = null;
    this.emitError(`codex: app-server exited unexpectedly${detail ? ` (${detail})` : ''}`);
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
        // A reasoning item can carry several independent summary segments; mirror the '\n\n'
        // separator the completed item's summary array is joined with, so streamed segments don't
        // merge into one run-on thought (and the length backstop below stays aligned).
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
        const entries = plan.reduce<PlanEntry[]>((acc, step) => {
          if (!isRecord(step)) return acc;
          const content = stringField(step, 'step');
          if (content) {
            acc.push({
              content,
              priority: 'medium',
              status: mapCodexPlanStatus(stringField(step, 'status')),
            });
          }
          return acc;
        }, []);
        this.emit({ type: 'plan', plan: { entries } });
        break;
      }
      case 'thread/tokenUsage/updated': {
        // `total` (thread-cumulative), not `last`: this fires once per model call and a turn with
        // tool round-trips has several; consumers replace usage wholesale, so emitting the `last`
        // slice would show only the final sub-call's tokens.
        const tokenUsage = recordField(params, 'tokenUsage');
        const total = tokenUsage ? recordField(tokenUsage, 'total') : undefined;
        if (total) this.emitUsage(mapCodexTokenUsage(total));
        break;
      }
      case 'error': {
        const error = recordField(params, 'error');
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
    const next = this.pendingPrompts.shift();
    if (next) void this.startTurn(next);
    else this.emitStatus('idle');
  }

  private handleItem(item: Record<string, unknown>, completed: boolean): void {
    const type = stringField(item, 'type');
    const id = stringField(item, 'id');
    if (!type || !id) return;
    switch (type) {
      case 'agentMessage': {
        // Text streams via item/agentMessage/delta; on completion emit whatever the deltas
        // missed so the message survives even if the delta channel dropped.
        if (!completed) break;
        const text = stringField(item, 'text') ?? '';
        const seen = this.streamedTextLen.get(id) ?? 0;
        if (text.length > seen) this.emitAssistantText(text.slice(seen), asMessageId(id));
        break;
      }
      case 'reasoning': {
        // Reasoning streams via summary deltas; on completion emit whatever the deltas missed,
        // same length reconciliation as agentMessage (delta lengths + the '\n\n' separators from
        // summaryPartAdded add up to the joined summary). When raw-content deltas streamed
        // (item/reasoning/textDelta), the streamed length exceeds the summary and this is a no-op.
        if (!completed) break;
        const summary = item.summary;
        const text = Array.isArray(summary)
          ? summary.filter((part): part is string => typeof part === 'string').join('\n\n')
          : '';
        const seen = this.streamedTextLen.get(id) ?? 0;
        if (text.length > seen) this.emitThought(text.slice(seen), asMessageId(id));
        break;
      }
      case 'commandExecution': {
        const command = stringField(item, 'command');
        this.emitTool({
          toolCallId: id,
          title: command ?? 'command',
          kind: 'execute',
          status: mapCodexItemStatus(stringField(item, 'status')),
          content: textContent(stringField(item, 'aggregatedOutput') ?? ''),
          rawInput: { command, cwd: stringField(item, 'cwd') },
          rawOutput: numberField(item, 'exitCode'),
        });
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
          const displayPath = movePath ?? path;
          locations.push({ path: displayPath });
          const diff = stringField(change, 'diff');
          if (diff) {
            appendArrayInPlace(content, diffContentFromUnified(displayPath, diff));
          } else if (movePath) {
            appendArrayInPlace(content, textContent(`Renamed ${path} → ${movePath}`));
          }
        }
        this.emitTool({
          toolCallId: id,
          title: 'Apply file changes',
          kind: 'edit',
          status: mapCodexItemStatus(stringField(item, 'status')),
          content,
          locations,
        });
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
        if (text) this.emitAssistantText(text, asMessageId(id));
        break;
      }
      default:
        break;
    }
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
    const reason = stringField(params, 'reason');
    const outcome = await this.requestPermission(
      {
        toolCallId: itemId,
        title: command ?? (kind === 'edit' ? 'Apply file changes' : 'Run command'),
        kind,
        rawInput: { command, cwd: stringField(params, 'cwd'), reason },
      },
      PERMISSION_OPTIONS,
    );
    return { decision: decisionFromOutcome(outcome) };
  }
}
