import type {
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  AgentKind,
  ClientRequest,
  ClientResponse,
  ContentBlock,
  PermissionOption,
  PermissionOutcome,
  SessionStatus,
  StartOptions,
  StopReason,
  TokenUsage,
  ToolCallUpdate,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { Listeners } from '@linkcode/transport';
import type { Unsubscribe } from '@linkcode/transport';
import { nextMessageId, nextRequestId } from './adapter';
import type { AgentAdapter } from './adapter';

type PendingResolver = (value: unknown) => void;

/**
 * Adapter base class: consolidates event plumbing, lifecycle, and the agent→client request bridge so
 * subclasses only implement the SDK-specific bits (`onStart` / `onPrompt` / `onCancel` / `onStop`).
 *
 * The request bridge maps the asynchronous "agent asks the client something and waits for an answer"
 * pattern (Claude's `canUseTool`, ACP's `session/request_permission` and `fs`/`terminal` callbacks) onto
 * our one-way event + input channels: `requestPermission` / `requestClient` emit an event carrying a
 * `requestId` and return a Promise that resolves when the matching response arrives via `send()`.
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
  private readonly pending = new Map<string, PendingResolver>();

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
        return;
      case 'set-mode':
        await this.onSetMode(input.modeId);
        return;
      case 'permission-response':
        this.resolvePending(input.requestId, input.outcome);
        return;
      case 'client-response':
        this.resolvePending(input.requestId, input.response);
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
    this.emitStatus('stopped');
    this.events.clear();
    this.pending.clear();
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
  protected emitAssistantText(text: string, messageId = nextMessageId()): void {
    if (text.length === 0) return;
    this.emit({ type: 'agent-message-chunk', messageId, content: textBlock(text) });
  }
  protected emitAssistantContent(content: ContentBlock, messageId = nextMessageId()): void {
    this.emit({ type: 'agent-message-chunk', messageId, content });
  }
  protected emitThought(text: string, messageId = nextMessageId()): void {
    if (text.length === 0) return;
    this.emit({ type: 'agent-thought-chunk', messageId, content: textBlock(text) });
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

  // ── Agent→client request bridge (resolved by send permission-response / client-response) ──
  protected requestPermission(
    toolCall: ToolCallUpdate,
    options: PermissionOption[],
  ): Promise<PermissionOutcome> {
    const requestId = nextRequestId();
    return new Promise<PermissionOutcome>((resolve) => {
      this.pending.set(requestId, resolve as PendingResolver);
      this.emit({ type: 'permission-request', requestId, toolCall, options });
    });
  }
  protected requestClient(request: ClientRequest): Promise<ClientResponse> {
    const requestId = nextRequestId();
    return new Promise<ClientResponse>((resolve) => {
      this.pending.set(requestId, resolve as PendingResolver);
      this.emit({ type: 'client-request', requestId, request });
    });
  }
  private resolvePending(requestId: string, value: unknown): void {
    const resolve = this.pending.get(requestId);
    if (resolve) {
      this.pending.delete(requestId);
      resolve(value);
    }
  }

  /** Lazy-load an SDK module; on failure emit a clear error event and rethrow. */
  protected async loadSdk<T>(name: string, loader: () => Promise<T>): Promise<T> {
    try {
      return await loader();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `${this.kind}: SDK '${name}' is unavailable (${detail})`;
      this.emitError(message, 'sdk-unavailable', false);
      throw new Error(message, { cause: err });
    }
  }
}
