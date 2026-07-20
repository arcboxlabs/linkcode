import type {
  AgentCapabilities,
  AgentCommand,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  AgentKind,
  AgentModelOption,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  MessageId,
  PermissionOption,
  PermissionOutcome,
  Question,
  QuestionOutcome,
  SessionStatus,
  StartOptions,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallUpdate,
  UsageReport,
} from '@linkcode/schema';
import { AGENT_INPUT_CAPABILITIES, textBlock } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import { Listeners } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { AgentAdapter } from './adapter';
import { nextMessageId, nextRequestId } from './adapter';

type PermissionResolver = (outcome: PermissionOutcome) => void;
type QuestionResolver = (outcome: QuestionOutcome) => void;

/**
 * Adapter base class: event plumbing, lifecycle, tool-call normalization, and the permission
 * round-trip; subclasses implement only the SDK-specific hooks (`onStart` / `onPrompt` / `onCancel`
 * / `onStop`). Two enforced invariants: `emitTool` merges partial patches into per-id snapshots and
 * emits a complete `ToolCall` on every change (front-end replaces by id); `teardown` forces
 * unfinished tools to `failed` and resolves pending permission asks with `cancelled`, so a
 * mid-flight cancel/stop never leaves a tool stuck `in_progress` or an agent awaiting forever.
 */
export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly kind: AgentKind;

  get capabilities(): AgentCapabilities {
    return AGENT_INPUT_CAPABILITIES[this.kind];
  }

  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: false,
    resume: false,
  };

  protected readonly events = new Listeners<AgentEvent>();
  protected opts: StartOptions | null = null;
  /** Last announced provider-local id — `emitSessionRef` dedupes against it. */
  private sessionRef: AgentHistoryId | null = null;
  /** Last announced model / effort — `emitModel` / `emitEffort` dedupe against these. */
  private reflectedModel: string | null = null;
  private reflectedEffort: EffortLevel | null = null;
  /** Permission asks awaiting a reply, keyed by requestId. */
  private readonly pending = new Map<string, PermissionResolver>();
  /** Question asks awaiting a reply, keyed by requestId. */
  private readonly pendingQuestions = new Map<string, QuestionResolver>();
  /** Running tool-call snapshots, keyed by toolCallId — the source for `emitTool`'s full-snapshot emits. */
  private readonly toolCalls = new Map<string, ToolCall>();
  /** Current segment's ids, refreshed via `freshSegment()` at each turn/tool boundary so text /
   * thinking emitted before and after a tool render as separate bubbles instead of merging into one. */
  protected messageId: MessageId = nextMessageId();
  protected thoughtId: MessageId = nextMessageId();
  /** Per-item cursor for turning a provider's cumulative item text into deltas — see `streamDelta`. */
  private readonly textDeltaLen = new Map<string, number>();

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.emitStatus('starting');
    this.emit({ type: 'capabilities-update', capabilities: this.capabilities });
    // Apply the user's initial effort before the provider starts. Some adapters need it while
    // constructing their process/thread (claude `max`), while the shared hook also preserves the
    // same validation and reflection semantics as a later `set-effort` input.
    if (opts.effort !== undefined) await this.onSetEffort(opts.effort);
    await this.onStart(opts);
    this.emitStatus('idle');
  }

  listHistory(_opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    return Promise.resolve({ sessions: [] });
  }

  readHistory(_opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return Promise.reject(new Error(`${this.kind}: history read is not supported`));
  }

  resumeHistory(_opts: AgentHistoryResumeOptions, _startOpts: StartOptions): Promise<void> {
    return Promise.reject(new Error(`${this.kind}: history resume is not supported`));
  }

  async send(input: AgentInput): Promise<void> {
    switch (input.type) {
      case 'prompt':
        await this.onPrompt(input.content);
        return;
      case 'command':
        await this.onCommand(input.name, input.arguments);
        return;
      case 'shell-command':
        await this.onShellCommand(input.command);
        return;
      case 'cancel':
        await this.onCancel();
        // The interrupted turn won't deliver completion signals for whatever was in flight.
        this.teardown();
        return;
      case 'set-mode':
        await this.onSetMode(input.modeId);
        return;
      case 'set-approval-policy':
        await this.onSetApprovalPolicy(input.policyId);
        return;
      case 'set-model':
        await this.onSetModel(input.model);
        return;
      case 'set-effort':
        await this.onSetEffort(input.effort);
        return;
      case 'permission-response':
        this.resolvePending(input.requestId, input.outcome);
        break;
      case 'question-response':
        this.resolvePendingQuestion(input.requestId, input.outcome);
        break;
      default:
        break;
    }
  }

  onEvent(cb: (e: AgentEvent) => void): Unsubscribe {
    return this.events.add(cb);
  }

  async stop(): Promise<void> {
    try {
      await this.onStop();
    } catch {
      // Best-effort shutdown; never let cleanup errors mask the stop.
    }
    // Sweep before clearing listeners so the finalize/cancel emits still reach attached clients.
    this.teardown();
    this.emitStatus('stopped');
    this.events.clear();
    this.toolCalls.clear();
  }

  // ── Lifecycle hooks for subclasses ──
  //
  // Turn contract: a turn-starting hook (onPrompt / onCommand / onShellCommand) must emit status
  // 'running' BEFORE it resolves, even when the provider's own lifecycle events arrive later — the
  // engine's input gate reads status the moment send() settles and releases on a still-idle session.
  // A hook that emitted 'running' and then fails must emit 'idle' before rejecting, or the gate
  // never releases.
  protected abstract onStart(opts: StartOptions): Promise<void>;
  protected abstract onPrompt(content: ContentBlock[]): Promise<void>;
  /** Default: reject. Only adapters that advertise a catalog via `available-commands-update`
   * override this. */
  protected onCommand(_name: string, _args?: string): Promise<void> {
    return Promise.reject(new Error(`${this.kind}: slash commands are not supported`));
  }
  /** Default: reject. Only adapters whose provider has a shell passthrough override this. */
  protected onShellCommand(_command: string): Promise<void> {
    return Promise.reject(new Error(`${this.kind}: shell commands are not supported`));
  }
  protected onCancel(): Promise<void> {
    return Promise.resolve();
  }
  protected onSetMode(_modeId: string): Promise<void> {
    return Promise.resolve();
  }
  /** Default: reject. Only adapters with selectable approval policies override this. */
  protected onSetApprovalPolicy(_policyId: string): Promise<void> {
    return Promise.reject(new Error(`${this.kind}: changing the approval policy is not supported`));
  }
  /** Default: reject. Only adapters that can rebind the model on a live session override this. */
  protected onSetModel(_model: string): Promise<void> {
    return Promise.reject(new Error(`${this.kind}: model can only be set when starting a session`));
  }
  /** Default: reject. Only adapters that can rebind effort on a live session override this. */
  protected onSetEffort(_effort: EffortLevel): Promise<void> {
    return Promise.reject(new Error(`${this.kind}: changing effort is not supported`));
  }
  protected onStop(): Promise<void> {
    return Promise.resolve();
  }

  // ── Emit helpers ──
  protected emit(event: AgentEvent): void {
    this.events.emit(event);
  }
  protected emitStatus(status: SessionStatus): void {
    this.emit({ type: 'status', status });
  }
  /** Open a fresh message/thought segment: call at turn start and after every tool call, or
   * narration around a tool merges into one bubble. */
  protected freshSegment(): void {
    this.messageId = nextMessageId();
    this.thoughtId = nextMessageId();
  }
  protected emitAssistantText(text: string, messageId: MessageId, parentToolCallId?: string): void {
    if (text.length === 0) return;
    this.emit({
      type: 'agent-message-chunk',
      messageId,
      parentToolCallId,
      content: textBlock(text),
    });
  }
  protected emitThought(text: string, messageId: MessageId, parentToolCallId?: string): void {
    if (text.length === 0) return;
    this.emit({
      type: 'agent-thought-chunk',
      messageId,
      parentToolCallId,
      content: textBlock(text),
    });
  }

  /**
   * Convert a provider's cumulative per-item text into an incremental chunk keyed by `id`, emitted
   * as assistant text or thought. For providers (Codex, OpenCode) that report the whole text so far.
   */
  protected streamDelta(id: string, fullText: string, kind: 'message' | 'thought'): void {
    const prev = this.textDeltaLen.get(id) ?? 0;
    if (fullText.length <= prev) return;
    const delta = fullText.slice(prev);
    this.textDeltaLen.set(id, fullText.length);
    if (kind === 'message') this.emitAssistantText(delta, id as MessageId);
    else this.emitThought(delta, id as MessageId);
  }

  /**
   * Merge a partial tool-call patch into its running snapshot and emit the complete `ToolCall`:
   * adapters supply only the fields they have; every downstream `tool-call` is a full snapshot.
   */
  protected emitTool(patch: ToolCallUpdate): void {
    const existing = this.toolCalls.get(patch.toolCallId);
    // completed/failed is terminal: ignore late updates so a stray post-teardown event (denied
    // tool_result, completion after a cancel sweep) cannot revive a failed tool.
    if (existing && (existing.status === 'completed' || existing.status === 'failed')) return;
    const toolCall: ToolCall = existing
      ? {
          ...existing,
          title: patch.title ?? existing.title,
          kind: patch.kind ?? existing.kind,
          status: patch.status ?? existing.status,
          parentToolCallId: patch.parentToolCallId ?? existing.parentToolCallId,
          content: patch.content ?? existing.content,
          locations: patch.locations ?? existing.locations,
          rawInput: patch.rawInput ?? existing.rawInput,
          rawOutput: patch.rawOutput ?? existing.rawOutput,
        }
      : {
          toolCallId: patch.toolCallId,
          title: patch.title ?? patch.toolCallId,
          kind: patch.kind ?? 'other',
          status: patch.status ?? 'in_progress',
          parentToolCallId: patch.parentToolCallId,
          content: patch.content ?? [],
          locations: patch.locations,
          rawInput: patch.rawInput,
          rawOutput: patch.rawOutput,
        };
    this.toolCalls.set(toolCall.toolCallId, toolCall);
    this.emit({ type: 'tool-call', toolCall });
  }

  /** Announce the provider-local native id of the live run once known; re-emits only when it changes. */
  protected emitSessionRef(historyId: AgentHistoryId): void {
    if (this.sessionRef === historyId) return;
    this.sessionRef = historyId;
    this.emit({ type: 'session-ref', historyId });
  }
  protected emitUsage(usage: TokenUsage): void {
    this.emit({ type: 'token-usage', usage });
  }
  /** Announce a structured usage snapshot (a provider usage command's whole reply — see schema). */
  protected emitUsageReport(report: UsageReport): void {
    this.emit({ type: 'usage-report', report });
  }
  protected emitApprovalPolicy(state: ApprovalPolicyState): void {
    this.emit({ type: 'approval-policy-update', state });
  }
  /** Announce the model the session is running on; re-emits only when it changes. */
  protected emitModel(model: string): void {
    if (this.reflectedModel === model) return;
    this.reflectedModel = model;
    this.emit({ type: 'model-update', model });
  }
  /** Announce the reasoning-effort level the session is running at; re-emits only when it changes. */
  protected emitEffort(effort: EffortLevel): void {
    if (this.reflectedEffort === effort) return;
    this.reflectedEffort = effort;
    this.emit({ type: 'effort-update', effort });
  }
  /** Announce the session's slash-command catalog (full-replace semantics — see schema). */
  protected emitCommands(commands: AgentCommand[]): void {
    this.emit({ type: 'available-commands-update', commands });
  }
  /** Announce the session's model catalog (full-replace semantics — see schema). Only adapters
   * with an install-dependent model set emit this; static-catalog agents never do. */
  protected emitModels(models: AgentModelOption[]): void {
    this.emit({ type: 'available-models-update', models });
  }
  protected emitStop(stopReason: StopReason): void {
    this.emit({ type: 'stop', stopReason });
  }
  protected emitError(message: string, code?: string, recoverable = true): void {
    this.emit({ type: 'error', message, code, recoverable });
  }

  // ── Permission round-trip (resolved by a `permission-response` AgentInput, by id) ──
  protected requestPermission(
    toolCall: ToolCallUpdate,
    options: PermissionOption[],
  ): Promise<PermissionOutcome> {
    const requestId = nextRequestId();
    return new Promise<PermissionOutcome>((resolve) => {
      this.pending.set(requestId, resolve);
      this.emit({ type: 'permission-request', requestId, toolCall, options });
    });
  }
  private resolvePending(requestId: string, outcome: PermissionOutcome): void {
    const resolve = this.pending.get(requestId);
    if (resolve) {
      this.pending.delete(requestId);
      resolve(outcome);
    }
  }

  // ── Question round-trip (resolved by a `question-response` AgentInput, by id) ──
  protected requestQuestion(
    toolCall: ToolCallUpdate,
    questions: Question[],
  ): Promise<QuestionOutcome> {
    const requestId = nextRequestId();
    return new Promise<QuestionOutcome>((resolve) => {
      this.pendingQuestions.set(requestId, resolve);
      this.emit({ type: 'question-request', requestId, toolCall, questions });
    });
  }
  private resolvePendingQuestion(requestId: string, outcome: QuestionOutcome): void {
    const resolve = this.pendingQuestions.get(requestId);
    if (resolve) {
      this.pendingQuestions.delete(requestId);
      resolve(outcome);
    }
  }

  /**
   * Liveness sweep on cancel / stop / abnormal turn end: resolve pending permission/question asks
   * with `cancelled` and force non-terminal tool calls to `failed`, so no tool stays `in_progress`
   * and no agent hangs awaiting a reply. Idempotent.
   */
  protected teardown(): void {
    for (const resolve of this.pending.values()) resolve({ outcome: 'cancelled' });
    this.pending.clear();
    for (const resolve of this.pendingQuestions.values()) resolve({ outcome: 'cancelled' });
    this.pendingQuestions.clear();
    for (const toolCall of this.toolCalls.values()) {
      if (toolCall.status === 'completed' || toolCall.status === 'failed') continue;
      this.emitTool({ toolCallId: toolCall.toolCallId, status: 'failed' });
    }
  }

  /** Lazy-load an SDK module; on failure emit a clear error event and rethrow. */
  protected async loadSdk<T>(name: string, loader: () => Promise<T>): Promise<T> {
    try {
      return await loader();
    } catch (err) {
      const detail = extractErrorMessage(err) ?? 'Unknown error';
      const message = `${this.kind}: SDK '${name}' is unavailable (${detail})`;
      this.emitError(message, 'sdk-unavailable', false);
      throw new Error(message, { cause: err });
    }
  }
}
