import type {
  AgentEvent,
  AgentInput,
  ContentBlock,
  PermissionOutcome,
  SessionId,
  SessionInfo,
  StartOptions,
  WireMessage,
} from '@linkcode/schema';
import { type Transport, type Unsubscribe, createWireMessage } from '@linkcode/transport';

type EventCb = (event: AgentEvent) => void;

let __reqSeq = 0;
function nextClientReqId(): string {
  __reqSeq += 1;
  return `creq-${Date.now().toString(36)}-${__reqSeq.toString(36)}`;
}

/**
 * LinkCodeClient: the data-plane client shared across all platforms (PLAN §4.6).
 * Layers session semantics (start / prompt / subscribe / stop) on top of any Transport, agnostic to
 * whether it's a LocalTransport or a WsTransport to the daemon (PLAN §2.6).
 *
 * The daemon broadcasts events to every client, so control replies are paired by correlation id rather
 * than by order: each request carries a `clientReqId` and the reply echoes it as `replyTo`.
 */
export class LinkCodeClient {
  private readonly subscribers = new Map<SessionId, Set<EventCb>>();
  private readonly pendingStarts = new Map<string, (id: SessionId) => void>();
  private readonly pendingLists = new Map<string, (sessions: SessionInfo[]) => void>();
  private unsub: Unsubscribe | null = null;

  constructor(private readonly transport: Transport) {}

  async connect(): Promise<void> {
    await this.transport.connect();
    this.unsub = this.transport.onMessage((msg) => this.route(msg));
  }

  private route(msg: WireMessage): void {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.started': {
        this.pendingStarts.get(p.replyTo)?.(p.sessionId);
        this.pendingStarts.delete(p.replyTo);
        break;
      }
      case 'session.listed': {
        this.pendingLists.get(p.replyTo)?.(p.sessions);
        this.pendingLists.delete(p.replyTo);
        break;
      }
      case 'agent.event': {
        const subs = this.subscribers.get(p.sessionId);
        if (subs) for (const cb of subs) cb(p.event);
        break;
      }
      default:
        break;
    }
  }

  startSession(opts: StartOptions): Promise<SessionId> {
    const clientReqId = nextClientReqId();
    return new Promise<SessionId>((resolve) => {
      this.pendingStarts.set(clientReqId, resolve);
      this.transport.send(createWireMessage({ kind: 'session.start', clientReqId, opts }));
    });
  }

  listSessions(): Promise<SessionInfo[]> {
    const clientReqId = nextClientReqId();
    return new Promise<SessionInfo[]>((resolve) => {
      this.pendingLists.set(clientReqId, resolve);
      this.transport.send(createWireMessage({ kind: 'session.list', clientReqId }));
    });
  }

  /** Low-level: send any normalized input to a session. */
  send(sessionId: SessionId, input: AgentInput): void {
    this.transport.send(createWireMessage({ kind: 'agent.input', sessionId, input }));
  }

  /** Send a prompt as content blocks. */
  prompt(sessionId: SessionId, content: ContentBlock[]): void {
    this.send(sessionId, { type: 'prompt', content });
  }

  /** Convenience: send a plain-text prompt. */
  promptText(sessionId: SessionId, text: string): void {
    this.prompt(sessionId, [{ type: 'text', text }]);
  }

  /** Cancel the in-flight turn. */
  cancel(sessionId: SessionId): void {
    this.send(sessionId, { type: 'cancel' });
  }

  /** Switch the session mode. */
  setMode(sessionId: SessionId, modeId: string): void {
    this.send(sessionId, { type: 'set-mode', modeId });
  }

  /** Answer a pending permission-request. */
  respondPermission(sessionId: SessionId, requestId: string, outcome: PermissionOutcome): void {
    this.send(sessionId, { type: 'permission-response', requestId, outcome });
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
    this.pendingStarts.clear();
    this.pendingLists.clear();
    this.transport.close();
  }
}
