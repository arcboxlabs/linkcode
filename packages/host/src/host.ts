import { type AdapterFactory, type AgentAdapter, createAdapter } from '@linkcode/agent-adapter';
import type { SessionId, SessionInfo, WireMessage } from '@linkcode/schema';
import { type Transport, type Unsubscribe, createWireMessage } from '@linkcode/transport';

interface Session {
  adapter: AgentAdapter;
  unsub: Unsubscribe;
  info: SessionInfo;
}

/**
 * Host: the local core engine (PLAN §4.1).
 * Manages multiple agent sessions, pushing each adapter's normalized events down to clients over the
 * transport and routing input back up to the matching adapter.
 *
 * The transport is decoupled from the carrier: a direct local connection, a fan-out Hub serving many
 * clients, or a tunnel through the Server all use the same Host (PLAN §2.6). Because the daemon broadcasts
 * events to every attached client, request/response control messages are correlated by id: `session.start`
 * carries a `clientReqId` that the matching `session.started` echoes back as `replyTo`.
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
        const info: SessionInfo = {
          sessionId,
          kind: p.opts.kind,
          cwd: p.opts.cwd,
          status: 'starting',
          createdAt: Date.now(),
        };
        const unsub = adapter.onEvent((event) => {
          if (event.type === 'status') info.status = event.status;
          this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
        });
        this.sessions.set(sessionId, { adapter, unsub, info });
        await adapter.start(p.opts);
        this.transport.send(
          createWireMessage({ kind: 'session.started', replyTo: p.clientReqId, sessionId }),
        );
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
      case 'session.list': {
        const sessions = Array.from(this.sessions.values(), (s) => s.info);
        this.transport.send(
          createWireMessage({ kind: 'session.listed', replyTo: p.clientReqId, sessions }),
        );
        break;
      }
      case 'session.attach':
      case 'session.detach': {
        // Multi-device attach is implicit: events are broadcast to all clients. These are accepted as
        // no-ops for now; a future enhancement can replay buffered state to a freshly-attached client.
        break;
      }
      case 'ping': {
        this.transport.send(createWireMessage({ kind: 'pong' }));
        break;
      }
      // Downstream-only payloads (session.started / session.listed / agent.event / pong) are ignored here.
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
