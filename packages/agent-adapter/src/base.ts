import type {
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
  ContentBlock,
  EffortLevel,
  MessageId,
  PermissionOption,
  PermissionOutcome,
  SessionStatus,
  StartOptions,
  StopReason,
  TokenUsage,
  ToolCall,
  ToolCallUpdate,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import { Listeners } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { AgentAdapter } from './adapter';
import { nextMessageId, nextRequestId } from './adapter';

type PermissionResolver = (outcome: PermissionOutcome) => void;

/**
 * Adapter base class: consolidates event plumbing, lifecycle, tool-call normalization, and the permission
 * round-trip so subclasses only implement the SDK-specific bits (`onStart` / `onPrompt` / `onCancel` /
 * `onStop`).
 *
 * Two invariants are enforced here, not by convention:
 * - Tool calls: adapters feed partial `ToolCallUpdate` patches into `emitTool`, which merges them into a
 *   per-id running snapshot and emits a complete `ToolCall` on every change. Normalization lives in one
 *   place; the front-end can do a dumb replace-by-id.
 * - Liveness: a `tool-call` is announced before it runs and a permission ask awaits a reply, so a
 *   cancel/stop that arrives mid-flight could otherwise leave a tool stuck `in_progress` or an agent
 *   `await`-ing a permission forever. `teardown` sweeps both: unfinished tools are forced to `failed` and
 *   pending permission asks are resolved with `cancelled`.
 */
export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly kind: AgentKind;

  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: false,
    resume: false,
  };

  protected readonly events = new Listeners<AgentEvent>();
  protected opts: StartOptions | null = null;
  /** Last announced provider-local id — `emitSessionRef` dedupes against it. */
  private sessionRef: AgentHistoryId | null = null;
  /** Permission asks awaiting a reply, keyed by requestId. */
  private readonly pending = new Map<string, PermissionResolver>();
  /** Running tool-call snapshots, keyed by toolCallId — the source for `emitTool`'s full-snapshot emits. */
  private readonly toolCalls = new Map<string, ToolCall>();
  /** Current segment's ids, refreshed via `freshSegment()` at each turn/tool boundary so text /
   * thinking emitted before and after a tool render as separate bubbles instead of merging into one. */
  protected messageId: MessageId = nextMessageId();
  protected thoughtId: MessageId = nextMessageId();

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.emitStatus('starting');
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
      case 'cancel':
        await this.onCancel();
        // The interrupted turn won't deliver completion signals for whatever was in flight.
        this.teardown();
        return;
      case 'set-mode':
        await this.onSetMode(input.modeId);
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
  protected abstract onStart(opts: StartOptions): Promise<void>;
  protected abstract onPrompt(content: ContentBlock[]): Promise<void>;
  protected onCancel(): Promise<void> {
    return Promise.resolve();
  }
  protected onSetMode(_modeId: string): Promise<void> {
    return Promise.resolve();
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
  /** Opens a fresh message/thought segment: call at a turn boundary (prompt start) and after every
   * tool call so narration emitted after renders as a new bubble instead of merging with what came
   * before it. */
  protected freshSegment(): void {
    this.messageId = nextMessageId();
    this.thoughtId = nextMessageId();
  }
  protected emitAssistantText(text: string, messageId: MessageId): void {
    if (text.length === 0) return;
    this.emit({ type: 'agent-message-chunk', messageId, content: textBlock(text) });
  }
  protected emitAssistantContent(content: ContentBlock, messageId: MessageId): void {
    this.emit({ type: 'agent-message-chunk', messageId, content });
  }
  protected emitThought(text: string, messageId: MessageId): void {
    if (text.length === 0) return;
    this.emit({ type: 'agent-thought-chunk', messageId, content: textBlock(text) });
  }

  /**
   * Merge a partial tool-call patch into its running snapshot (creating it with sane defaults on first
   * sight) and emit the complete `ToolCall`. This is the single normalization point: adapters only ever
   * supply the fields they have, and every `tool-call` event downstream is a full snapshot.
   */
  protected emitTool(patch: ToolCallUpdate): void {
    const existing = this.toolCalls.get(patch.toolCallId);
    // A tool that already reached a terminal state never changes again. Ignoring late updates keeps
    // the "one snapshot per state change" model and stops a stray post-teardown event (e.g. a denied
    // tool_result, or a streamed completion arriving after a cancel sweep) from reviving a failed tool.
    if (existing && (existing.status === 'completed' || existing.status === 'failed')) return;
    const toolCall: ToolCall = existing
      ? {
          ...existing,
          title: patch.title ?? existing.title,
          kind: patch.kind ?? existing.kind,
          status: patch.status ?? existing.status,
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

  /**
   * Liveness sweep on cancel / stop / abnormal turn end: resolve every still-pending permission ask with
   * `cancelled` (a clean deny that unblocks the agent's awaiting callback) and force every non-terminal
   * tool call to `failed`. Together these guarantee no tool stays `in_progress` and no agent hangs awaiting
   * a permission reply. Idempotent — a no-op on a clean turn where everything is already settled.
   */
  protected teardown(): void {
    for (const resolve of this.pending.values()) resolve({ outcome: 'cancelled' });
    this.pending.clear();
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
