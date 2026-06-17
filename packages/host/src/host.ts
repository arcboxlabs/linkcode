import { type AdapterFactory, type AgentAdapter, createAdapter } from '@linkcode/agent-adapter';
import type { SessionId, WireMessage } from '@linkcode/schema';
import { type Transport, type Unsubscribe, createWireMessage } from '@linkcode/transport';

interface Session {
  adapter: AgentAdapter;
  unsub: Unsubscribe;
}

/**
 * Host: the local core engine (PLAN §4.1).
 * Manages multiple agent sessions, pushing the adapter's normalized events down to the client over the
 * transport, and routing the input sent up from the client to the corresponding adapter.
 *
 * The transport is decoupled from the carrier: a direct local connection or a tunnel through the Server
 * both use the same Host (PLAN §2.6).
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
        // TODO: Error reporting (pending confirmation of the Server realtime / perm model, PLAN §10.7).
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
      // Downstream types (session.started / agent.event / pong) are not handled on the host side.
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
