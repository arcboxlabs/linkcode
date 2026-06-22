import { type AdapterFactory, type AgentAdapter, createAdapter } from '@linkcode/agent-adapter';
import type {
  AgentKind,
  SessionId,
  SessionInfo,
  StartOptions,
  WireMessage,
} from '@linkcode/schema';
import { createWireMessage, type Transport, type Unsubscribe } from '@linkcode/transport';
import { HistoryService } from './history-service';

interface Session {
  adapter: AgentAdapter;
  unsub: Unsubscribe;
  info: SessionInfo;
}

/**
 * Engine: the local core engine — the "host" that runs the agents (PLAN §4.1).
 * Manages multiple agent sessions, pushing each adapter's normalized events down to clients over the
 * transport and routing input back up to the matching adapter.
 *
 * The transport is decoupled from the carrier: a direct local connection, a fan-out Hub serving many
 * clients, or a tunnel through the Server all use the same Engine (PLAN §2.6). Because the daemon broadcasts
 * events to every attached client, request/response control messages are correlated by id: `session.start`
 * carries a `clientReqId` that the matching `session.started` echoes back as `replyTo`.
 */
export class Engine {
  private readonly sessions = new Map<SessionId, Session>();
  private readonly history: HistoryService;
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    private readonly factory: AdapterFactory = createAdapter,
  ) {
    this.history = new HistoryService(factory);
  }

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
        await this.tryReply(p.clientReqId, () =>
          this.startLiveSession(p.clientReqId, p.opts.kind, p.opts, (adapter) =>
            adapter.start(p.opts),
          ),
        );
        break;
      }
      case 'agent.input': {
        await this.tryReply(p.clientReqId, async () => {
          const session = this.sessions.get(p.sessionId);
          if (!session) throw new Error(`Unknown session: ${p.sessionId}`);
          await session.adapter.send(p.input);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.stop': {
        await this.tryReply(p.clientReqId, async () => {
          const session = this.sessions.get(p.sessionId);
          if (!session) throw new Error(`Unknown session: ${p.sessionId}`);
          session.unsub();
          await session.adapter.stop();
          this.sessions.delete(p.sessionId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.list': {
        const sessions = Array.from(this.sessions.values(), (s) => s.info);
        this.transport.send(
          createWireMessage({ kind: 'session.listed', replyTo: p.clientReqId, sessions }),
        );
        break;
      }
      case 'history.list': {
        await this.tryReply(p.clientReqId, async () => {
          const result = await this.history.list(p.agentKind, p.opts);
          this.transport.send(
            createWireMessage({ kind: 'history.listed', replyTo: p.clientReqId, result }),
          );
        });
        break;
      }
      case 'history.read': {
        await this.tryReply(p.clientReqId, async () => {
          const result = await this.history.read(p.agentKind, p.opts);
          this.transport.send(
            createWireMessage({ kind: 'history.read.result', replyTo: p.clientReqId, result }),
          );
        });
        break;
      }
      case 'history.resume': {
        const startOpts: StartOptions = { ...p.startOpts, kind: p.agentKind };
        await this.tryReply(p.clientReqId, () =>
          this.startLiveSession(p.clientReqId, p.agentKind, startOpts, (adapter) =>
            this.history.resume(adapter, p.historyId, startOpts),
          ),
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
      // Downstream-only payloads are ignored here.
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

  private async startLiveSession(
    replyTo: string,
    kind: AgentKind,
    opts: StartOptions,
    startAdapter: (adapter: AgentAdapter) => Promise<void>,
  ): Promise<void> {
    const sessionId = this.nextSessionId();
    const adapter = this.factory(kind);
    const info: SessionInfo = {
      sessionId,
      kind,
      cwd: opts.cwd,
      status: 'starting',
      createdAt: Date.now(),
    };
    const unsub = adapter.onEvent((event) => {
      if (event.type === 'status') info.status = event.status;
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    });
    this.sessions.set(sessionId, { adapter, unsub, info });
    try {
      await startAdapter(adapter);
    } catch (err) {
      unsub();
      this.sessions.delete(sessionId);
      await adapter.stop().catch(() => undefined);
      throw err;
    }
    this.transport.send(createWireMessage({ kind: 'session.started', replyTo, sessionId }));
  }

  private async tryReply(replyTo: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.sendFailure(replyTo, err);
    }
  }

  private sendFailure(replyTo: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.transport.send(createWireMessage({ kind: 'request.failed', replyTo, message }));
  }

  private sendSuccess(replyTo: string): void {
    this.transport.send(createWireMessage({ kind: 'request.succeeded', replyTo }));
  }
}
