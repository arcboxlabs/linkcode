import type {
  AgentEvent,
  AgentInput,
  SessionId,
  StartOptions,
  WireMessage,
} from '@linkcode/schema';
import { type Transport, type Unsubscribe, createWireMessage } from '@linkcode/transport';

type EventCb = (event: AgentEvent) => void;

/**
 * LinkCodeClient：三端共享的数据面客户端（PLAN §4.6）。
 * 在 transport 之上提供会话语义（启动 / 发送 / 订阅事件 / 停止），
 * 不感知底层是 LocalTransport 还是 WsTransport（PLAN §2.6）。
 */
export class LinkCodeClient {
  private readonly subscribers = new Map<SessionId, Set<EventCb>>();
  private readonly pendingStarts: Array<(id: SessionId) => void> = [];
  private unsub: Unsubscribe | null = null;

  constructor(private readonly transport: Transport) {}

  async connect(): Promise<void> {
    await this.transport.connect();
    this.unsub = this.transport.onMessage((msg) => this.route(msg));
  }

  private route(msg: WireMessage): void {
    const p = msg.payload;
    if (p.kind === 'session.started') {
      // FIFO 配对：解析最早一个等待中的 startSession。
      this.pendingStarts.shift()?.(p.sessionId);
    } else if (p.kind === 'agent.event') {
      const subs = this.subscribers.get(p.sessionId);
      if (subs) for (const cb of subs) cb(p.event);
    }
  }

  startSession(opts: StartOptions): Promise<SessionId> {
    return new Promise<SessionId>((resolve) => {
      this.pendingStarts.push(resolve);
      this.transport.send(createWireMessage({ kind: 'session.start', opts }));
    });
  }

  send(sessionId: SessionId, input: AgentInput): void {
    this.transport.send(createWireMessage({ kind: 'agent.input', sessionId, input }));
  }

  stopSession(sessionId: SessionId): void {
    this.transport.send(createWireMessage({ kind: 'session.stop', sessionId }));
    this.subscribers.delete(sessionId);
  }

  subscribe(sessionId: SessionId, cb: EventCb): Unsubscribe {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  dispose(): void {
    this.unsub?.();
    this.subscribers.clear();
    this.transport.close();
  }
}
