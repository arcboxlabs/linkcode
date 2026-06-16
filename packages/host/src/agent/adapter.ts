import type { AgentEvent, AgentInput, AgentKind, MessageId, StartOptions } from '@linkcode/schema';
import { Listeners, type Unsubscribe } from '@linkcode/transport';

/**
 * AgentAdapter：接入各家 coding agent SDK 的统一适配接口（PLAN §4.2 / §6）。
 * 每家一个 adapter，向上屏蔽差异；不在上层散落各家 SDK 判断（PLAN §2.5）。
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  start(opts: StartOptions): Promise<void>;
  send(input: AgentInput): Promise<void>;
  /** 订阅抽象层归一化后的事件。 */
  onEvent(cb: (e: AgentEvent) => void): Unsubscribe;
  stop(): Promise<void>;
}

let __msgSeq = 0;
/** 生成一个归一化消息 ID。 */
export function nextMessageId(): MessageId {
  __msgSeq += 1;
  return `msg-${Date.now().toString(36)}-${__msgSeq.toString(36)}` as MessageId;
}

/**
 * 适配器基类：收敛事件订阅 / 生命周期样板，子类只需实现 `send`。
 *
 * ⚠️ 当前所有内置 adapter 都是**桩实现**：只回显输入、不调用真实 SDK。
 *    Claude Code / CodeX / OpenCode / Pi 各自的接入形态（进程 / HTTP / 库）
 *    尚待确认（PLAN §4.2 / §10.3），确认后再在对应子类落地真实 SDK 调用。
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

  /** 桩通用回显：把一条用户消息回显为一条助手消息。 */
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
