import type { AgentEvent, AgentInput, AgentKind, MessageId, StartOptions } from '@linkcode/schema';
import { Listeners, type Unsubscribe } from '@linkcode/transport';

/**
 * AgentAdapter: the unified adapter interface for integrating each coding agent SDK (PLAN §4.2 / §6).
 * One adapter per agent, hiding their differences from the upper layers; no per-SDK branching scattered
 * across the upper layers (PLAN §2.5).
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  start(opts: StartOptions): Promise<void>;
  send(input: AgentInput): Promise<void>;
  /** Subscribe to events normalized by the abstraction layer. */
  onEvent(cb: (e: AgentEvent) => void): Unsubscribe;
  stop(): Promise<void>;
}

let __msgSeq = 0;
/** Generate a normalized message ID. */
export function nextMessageId(): MessageId {
  __msgSeq += 1;
  return `msg-${Date.now().toString(36)}-${__msgSeq.toString(36)}` as MessageId;
}

/**
 * Adapter base class: consolidates the event-subscription and lifecycle boilerplate, so subclasses
 * only need to implement `send`.
 *
 * ⚠️ All built-in adapters are currently **stub implementations**: they only echo the input and do not
 *    call the real SDKs. The integration form (process / HTTP / library) for each of Claude Code / CodeX /
 *    OpenCode / Pi is still to be confirmed (PLAN §4.2 / §10.3); once confirmed, the real SDK calls will be
 *    implemented in the corresponding subclasses.
 */
export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly kind: AgentKind;

  protected readonly events = new Listeners<AgentEvent>();
  protected opts: StartOptions | null = null;

  start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.emit({ type: 'status', status: 'idle' });
    return Promise.resolve();
  }

  abstract send(input: AgentInput): Promise<void>;

  onEvent(cb: (e: AgentEvent) => void): Unsubscribe {
    return this.events.add(cb);
  }

  stop(): Promise<void> {
    this.emit({ type: 'status', status: 'stopped' });
    this.events.clear();
    return Promise.resolve();
  }

  protected emit(event: AgentEvent): void {
    this.events.emit(event);
  }

  /** Generic stub echo: echo a user message back as an assistant message. */
  protected echo(text: string): void {
    this.emit({ type: 'status', status: 'running' });
    this.emit({
      type: 'assistant-delta',
      messageId: nextMessageId(),
      text: `[${this.kind} 桩实现] 收到：${text}`,
      done: true,
    });
    this.emit({ type: 'status', status: 'idle' });
  }
}
