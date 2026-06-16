import type { SessionId, WireMessage } from '@linkcode/schema';
import { type Transport, type Unsubscribe, createWireMessage } from '@linkcode/transport';
import type { AgentAdapter } from './agent/adapter';
import { type AdapterFactory, createAdapter } from './agent/registry';

interface Session {
  adapter: AgentAdapter;
  unsub: Unsubscribe;
}

/**
 * Host：本地核心引擎（PLAN §4.1）。
 * 管理多个 agent 会话，把 adapter 归一化事件经 transport 下发给客户端，
 * 并把客户端上行的 input 路由到对应 adapter。
 *
 * transport 与承载解耦：本地直连或经 Server 隧道都用同一个 Host（PLAN §2.6）。
 */
export class Host {
  private readonly sessions = new Map<SessionId, Session>();
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    private readonly factory: AdapterFactory = createAdapter,
  ) {}

  async start(): Promise<void> {
    await this.transport.connect();
    this.transport.onMessage((msg) => {
      this.handle(msg).catch(() => {
        // TODO: 错误上报（待 Server realtime / perm 模型确认，PLAN §10.7）。
      });
    });
  }

  private async handle(msg: WireMessage): Promise<void> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.start': {
        const sessionId = this.nextSessionId();
        const adapter = this.factory(p.opts.kind);
        const unsub = adapter.onEvent((event) => {
          this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
        });
        this.sessions.set(sessionId, { adapter, unsub });
        await adapter.start(p.opts);
        this.transport.send(createWireMessage({ kind: 'session.started', sessionId }));
        break;
      }
      case 'agent.input': {
        await this.sessions.get(p.sessionId)?.adapter.send(p.input);
        break;
      }
      case 'session.stop': {
        const session = this.sessions.get(p.sessionId);
        if (session) {
          session.unsub();
          await session.adapter.stop();
          this.sessions.delete(p.sessionId);
        }
        break;
      }
      case 'ping': {
        this.transport.send(createWireMessage({ kind: 'pong' }));
        break;
      }
      // 下行类型（session.started / agent.event / pong）host 端不处理。
      default:
        break;
    }
  }

  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.unsub();
      await session.adapter.stop();
    }
    this.sessions.clear();
    this.transport.close();
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
  }
}
