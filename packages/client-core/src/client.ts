import type {
  AgentEvent,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
  ContentBlock,
  PermissionOutcome,
  SessionId,
  SessionInfo,
  StartOptions,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import { createWireMessage, type Transport, type Unsubscribe } from '@linkcode/transport';

type EventCb = (event: AgentEvent) => void;
type Pending<T> = {
  resolve(value: T): void;
  reject(err: Error): void;
};
type RequestAck = { ok: true };

export type HistoryListClientOptions = AgentHistoryListOptions & {
  forceRefresh?: boolean;
};

export type HistoryReadClientOptions = AgentHistoryReadOptions & {
  forceRefresh?: boolean;
};

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
  /** Per-session event buffer so a re-subscribe (switching the active session back) can replay the timeline. */
  private readonly events = new Map<SessionId, AgentEvent[]>();
  private readonly pendingStarts = new Map<string, Pending<SessionId>>();
  private readonly pendingLists = new Map<string, Pending<SessionInfo[]>>();
  private readonly pendingHistoryLists = new Map<string, Pending<AgentHistoryListResult>>();
  private readonly pendingHistoryReads = new Map<string, Pending<AgentHistoryReadResult>>();
  private readonly pendingAcks = new Map<string, Pending<RequestAck>>();
  private unsub: Unsubscribe | null = null;
  private offClose: Unsubscribe | null = null;
  private closed = false;

  constructor(private readonly transport: Transport) {}

  async connect(): Promise<void> {
    this.closed = false;
    await this.transport.connect();
    // The caller's effect may have been torn down mid-await (React StrictMode / remount); bail if so.
    if (this.closed) return;
    this.unsub?.();
    this.unsub = this.transport.onMessage((msg) => this.route(msg));
    this.offClose?.();
    this.offClose = this.transport.onClose(() =>
      this.failAllPending(new Error('transport connection closed')),
    );
  }

  private route(msg: WireMessage): void {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.started': {
        this.pendingStarts.get(p.replyTo)?.resolve(p.sessionId);
        this.pendingStarts.delete(p.replyTo);
        break;
      }
      case 'session.listed': {
        this.pendingLists.get(p.replyTo)?.resolve(p.sessions);
        this.pendingLists.delete(p.replyTo);
        break;
      }
      case 'history.listed': {
        this.pendingHistoryLists.get(p.replyTo)?.resolve(p.result);
        this.pendingHistoryLists.delete(p.replyTo);
        break;
      }
      case 'history.read.result': {
        this.pendingHistoryReads.get(p.replyTo)?.resolve(p.result);
        this.pendingHistoryReads.delete(p.replyTo);
        break;
      }
      case 'request.failed': {
        this.rejectPending(p.replyTo, p.message, p.code);
        break;
      }
      case 'request.succeeded': {
        this.pendingAcks.get(p.replyTo)?.resolve({ ok: true });
        this.pendingAcks.delete(p.replyTo);
        break;
      }
      case 'agent.event': {
        const buf = this.events.get(p.sessionId);
        if (buf) buf.push(p.event);
        else this.events.set(p.sessionId, [p.event]);
        const subs = this.subscribers.get(p.sessionId);
        if (subs) for (const cb of subs) cb(p.event);
        break;
      }
      default:
        break;
    }
  }

  startSession(opts: StartOptions): Promise<SessionId> {
    return this.sendCorrelated(this.pendingStarts, (clientReqId) => ({
      kind: 'session.start',
      clientReqId,
      opts,
    }));
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.sendCorrelated(this.pendingLists, (clientReqId) => ({
      kind: 'session.list',
      clientReqId,
    }));
  }

  listHistory(
    agentKind: AgentKind,
    opts?: HistoryListClientOptions,
  ): Promise<AgentHistoryListResult> {
    return this.sendCorrelated(this.pendingHistoryLists, (clientReqId) => ({
      kind: 'history.list',
      clientReqId,
      agentKind,
      opts,
    }));
  }

  readHistory(
    agentKind: AgentKind,
    opts: HistoryReadClientOptions,
  ): Promise<AgentHistoryReadResult> {
    return this.sendCorrelated(this.pendingHistoryReads, (clientReqId) => ({
      kind: 'history.read',
      clientReqId,
      agentKind,
      opts,
    }));
  }

  resumeHistory(
    agentKind: AgentKind,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): Promise<SessionId> {
    return this.sendCorrelated(this.pendingStarts, (clientReqId) => ({
      kind: 'history.resume',
      clientReqId,
      agentKind,
      historyId,
      startOpts: { ...startOpts, kind: agentKind },
    }));
  }

  /** Low-level: send any normalized input to a session. */
  send(sessionId: SessionId, input: AgentInput): Promise<RequestAck> {
    return this.sendCorrelated(this.pendingAcks, (clientReqId) => ({
      kind: 'agent.input',
      clientReqId,
      sessionId,
      input,
    }));
  }

  /** Send a prompt as content blocks. */
  prompt(sessionId: SessionId, content: ContentBlock[]): Promise<RequestAck> {
    return this.send(sessionId, { type: 'prompt', content });
  }

  /** Convenience: send a plain-text prompt. */
  promptText(sessionId: SessionId, text: string): Promise<RequestAck> {
    return this.prompt(sessionId, [{ type: 'text', text }]);
  }

  /** Cancel the in-flight turn. */
  cancel(sessionId: SessionId): Promise<RequestAck> {
    return this.send(sessionId, { type: 'cancel' });
  }

  /** Switch the session mode. */
  setMode(sessionId: SessionId, modeId: string): Promise<RequestAck> {
    return this.send(sessionId, { type: 'set-mode', modeId });
  }

  /** Answer a pending permission-request. */
  respondPermission(
    sessionId: SessionId,
    requestId: string,
    outcome: PermissionOutcome,
  ): Promise<RequestAck> {
    return this.send(sessionId, { type: 'permission-response', requestId, outcome });
  }

  stopSession(sessionId: SessionId): Promise<RequestAck> {
    return this.sendCorrelated(this.pendingAcks, (clientReqId) => ({
      kind: 'session.stop',
      clientReqId,
      sessionId,
    })).then((ack) => {
      this.subscribers.delete(sessionId);
      this.events.delete(sessionId);
      return ack;
    });
  }

  subscribe(sessionId: SessionId, cb: EventCb): Unsubscribe {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(cb);
    // Replay any buffered events so a late subscriber sees the full timeline, not a blank pane.
    const buf = this.events.get(sessionId);
    if (buf) for (const event of buf) cb(event);
    return () => set?.delete(cb);
  }

  dispose(): void {
    this.closed = true;
    this.unsub?.();
    this.unsub = null;
    this.offClose?.();
    this.offClose = null;
    this.failAllPending(new Error('client disposed'));
    this.subscribers.clear();
    this.events.clear();
    this.transport.close();
  }

  /** Reject every in-flight request so awaiters get an error instead of hanging forever. */
  private failAllPending(err: Error): void {
    for (const map of [
      this.pendingStarts,
      this.pendingLists,
      this.pendingHistoryLists,
      this.pendingHistoryReads,
      this.pendingAcks,
    ]) {
      for (const pending of map.values()) pending.reject(err);
      map.clear();
    }
  }

  private rejectPending(replyTo: string, message: string, code?: string): void {
    const err = new Error(message);
    if (code) Object.assign(err, { code });
    if (rejectFrom(this.pendingStarts, replyTo, err)) return;
    if (rejectFrom(this.pendingLists, replyTo, err)) return;
    if (rejectFrom(this.pendingHistoryLists, replyTo, err)) return;
    if (rejectFrom(this.pendingHistoryReads, replyTo, err)) return;
    rejectFrom(this.pendingAcks, replyTo, err);
  }

  private sendCorrelated<T>(
    pendingMap: Map<string, Pending<T>>,
    makePayload: (clientReqId: string) => WirePayload,
  ): Promise<T> {
    const clientReqId = nextClientReqId();
    return new Promise<T>((resolve, reject) => {
      pendingMap.set(clientReqId, { resolve, reject });
      try {
        const sent = this.transport.send(createWireMessage(makePayload(clientReqId)));
        void Promise.resolve(sent).catch((err) => {
          rejectFrom(pendingMap, clientReqId, toError(err));
        });
      } catch (err) {
        rejectFrom(pendingMap, clientReqId, toError(err));
      }
    });
  }
}

function rejectFrom<T>(map: Map<string, Pending<T>>, id: string, err: Error): boolean {
  const pending = map.get(id);
  if (!pending) return false;
  map.delete(id);
  pending.reject(err);
  return true;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
