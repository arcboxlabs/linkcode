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
  ProvidersConfig,
  SessionId,
  SessionInfo,
  SessionRecord,
  StartOptions,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';

type EventCb = (event: AgentEvent) => void;
type TerminalOutputCb = (data: string) => void;
type TerminalExitCb = (exitCode: number | null) => void;
type TerminalErrorCb = (err: Error) => void;
interface Pending<T> {
  resolve(value: T): void;
  reject(err: Error): void;
}
interface RequestAck {
  ok: true;
}

export type HistoryListClientOptions = AgentHistoryListOptions & {
  forceRefresh?: boolean;
};

export type HistoryReadClientOptions = AgentHistoryReadOptions & {
  forceRefresh?: boolean;
};

/** Cap on per-terminal output buffered before the first subscriber, so an unread PTY can't grow unbounded. */
const TERMINAL_PREBUFFER_CAP = 128 * 1024;

/** Stable empty snapshot for sessions with no buffered events yet. */
const NO_EVENTS: readonly AgentEvent[] = [];

/**
 * Trim buffered terminal output to the cap on a line boundary. Slicing raw would leave the buffer
 * starting mid-ANSI-escape (the head byte gone, the tail rendered as literal garbage); dropping the
 * partial leading line keeps the replay parseable.
 */
function capPrebuffer(text: string): string {
  if (text.length <= TERMINAL_PREBUFFER_CAP) return text;
  const sliced = text.slice(-TERMINAL_PREBUFFER_CAP);
  const nl = sliced.indexOf('\n');
  return nl === -1 ? sliced : sliced.slice(nl + 1);
}

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
  /**
   * Per-session event timeline: replaced (not mutated) on append so `getEvents` snapshots are
   * referentially stable between events (safe for `useSyncExternalStore`). Retained across
   * `stopSession` — the daemon does not replay history on resume, so this buffer is the only
   * copy of a cold session's timeline.
   */
  private readonly events = new Map<SessionId, readonly AgentEvent[]>();
  private readonly pendingStarts = new Map<string, Pending<SessionId>>();
  private readonly pendingLists = new Map<string, Pending<SessionInfo[]>>();
  private readonly pendingImports = new Map<string, Pending<SessionRecord>>();
  private readonly pendingHistoryLists = new Map<string, Pending<AgentHistoryListResult>>();
  private readonly pendingHistoryReads = new Map<string, Pending<AgentHistoryReadResult>>();
  private readonly pendingConfigGets = new Map<string, Pending<ProvidersConfig>>();
  private readonly pendingAcks = new Map<string, Pending<RequestAck>>();
  private readonly pendingTerminalOpens = new Map<string, Pending<string>>();
  private readonly terminalOutputSubs = new Map<string, Set<TerminalOutputCb>>();
  private readonly terminalExitSubs = new Map<string, Set<TerminalExitCb>>();
  /** Notified when a fire-and-forget terminal frame (input/resize/close) fails to send. */
  private readonly terminalErrorSubs = new Map<string, Set<TerminalErrorCb>>();
  /** Output seen before anyone subscribed (covers the open→subscribe gap and late mounts); capped. */
  private readonly terminalPrebuffer = new Map<string, string>();
  private unsub: Unsubscribe | null = null;
  private offClose: Unsubscribe | null = null;
  private closed = false;

  constructor(private readonly transport: Transport) {}

  async connect(): Promise<void> {
    this.closed = false;
    await this.transport.connect();
    // The caller's effect may have been torn down mid-await (React StrictMode / remount); bail if so.
    if (this.isClosed()) return;
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
      case 'session.imported': {
        this.pendingImports.get(p.replyTo)?.resolve(p.record);
        this.pendingImports.delete(p.replyTo);
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
      case 'config.get.result': {
        this.pendingConfigGets.get(p.replyTo)?.resolve(p.providers);
        this.pendingConfigGets.delete(p.replyTo);
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
        this.events.set(p.sessionId, buf ? [...buf, p.event] : [p.event]);
        const subs = this.subscribers.get(p.sessionId);
        if (subs) for (const cb of subs) cb(p.event);
        break;
      }
      case 'terminal.opened': {
        this.pendingTerminalOpens.get(p.replyTo)?.resolve(p.terminalId);
        this.pendingTerminalOpens.delete(p.replyTo);
        break;
      }
      case 'terminal.output': {
        const subs = this.terminalOutputSubs.get(p.terminalId);
        if (subs && subs.size > 0) {
          for (const cb of subs) cb(p.data);
        } else {
          const prev = this.terminalPrebuffer.get(p.terminalId) ?? '';
          this.terminalPrebuffer.set(p.terminalId, capPrebuffer(prev + p.data));
        }
        break;
      }
      case 'terminal.exit': {
        const subs = this.terminalExitSubs.get(p.terminalId);
        if (subs) for (const cb of subs) cb(p.exitCode);
        this.terminalOutputSubs.delete(p.terminalId);
        this.terminalExitSubs.delete(p.terminalId);
        this.terminalErrorSubs.delete(p.terminalId);
        this.terminalPrebuffer.delete(p.terminalId);
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

  /** Resume a persisted (cold) session by its Link Code id; resolves with the same id. */
  resumeSession(sessionId: SessionId): Promise<SessionId> {
    return this.sendCorrelated(this.pendingStarts, (clientReqId) => ({
      kind: 'session.resume',
      clientReqId,
      sessionId,
    }));
  }

  /** Import a provider-local history session as a cold record (listed, not started). */
  importSession(agentKind: AgentKind, historyId: AgentHistoryId): Promise<SessionRecord> {
    return this.sendCorrelated(this.pendingImports, (clientReqId) => ({
      kind: 'session.import',
      clientReqId,
      agentKind,
      historyId,
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

  /** Switch the session's model, going forward. Rejects if the adapter can't rebind a live session. */
  setModel(sessionId: SessionId, model: string): Promise<RequestAck> {
    return this.send(sessionId, { type: 'set-model', model });
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
    // Subscribers and the event buffer survive the stop: the session record stays listed (cold),
    // and resuming keeps the same id — dropping either would mute or blank a still-rendered timeline.
    return this.sendCorrelated(this.pendingAcks, (clientReqId) => ({
      kind: 'session.stop',
      clientReqId,
      sessionId,
    }));
  }

  /** Read the daemon-owned provider config (data plane). */
  getProviderConfig(): Promise<ProvidersConfig> {
    return this.sendCorrelated(this.pendingConfigGets, (clientReqId) => ({
      kind: 'config.get',
      clientReqId,
    }));
  }

  /** Persist the daemon-owned provider config (data plane). */
  setProviderConfig(providers: ProvidersConfig): Promise<RequestAck> {
    return this.sendCorrelated(this.pendingAcks, (clientReqId) => ({
      kind: 'config.set',
      clientReqId,
      providers,
    }));
  }

  /** Snapshot of a session's buffered timeline; the reference only changes when an event arrives. */
  getEvents(sessionId: SessionId): readonly AgentEvent[] {
    return this.events.get(sessionId) ?? NO_EVENTS;
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
    return () => set.delete(cb);
  }

  openTerminal(opts: {
    cols: number;
    rows: number;
    cwd?: string;
    shell?: string;
    sessionId?: SessionId;
  }): Promise<string> {
    return this.sendCorrelated(this.pendingTerminalOpens, (clientReqId) => ({
      kind: 'terminal.open',
      clientReqId,
      opts,
    }));
  }

  terminalInput(terminalId: string, data: string): void {
    this.sendTerminalFrame(terminalId, { kind: 'terminal.input', terminalId, data });
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    this.sendTerminalFrame(terminalId, { kind: 'terminal.resize', terminalId, cols, rows });
  }

  closeTerminal(terminalId: string): void {
    this.sendTerminalFrame(terminalId, { kind: 'terminal.close', terminalId });
  }

  subscribeTerminalOutput(terminalId: string, cb: TerminalOutputCb): Unsubscribe {
    let set = this.terminalOutputSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.terminalOutputSubs.set(terminalId, set);
    }
    set.add(cb);
    // Replay output buffered before a subscriber attached. Kept (not deleted) until `terminal.exit`
    // so a remount/second subscriber still gets the initial prompt instead of a blank pane.
    const buffered = this.terminalPrebuffer.get(terminalId);
    if (buffered !== undefined) cb(buffered);
    return () => set.delete(cb);
  }

  subscribeTerminalExit(terminalId: string, cb: TerminalExitCb): Unsubscribe {
    let set = this.terminalExitSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.terminalExitSubs.set(terminalId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  /**
   * Observe transport-send failures for a terminal's fire-and-forget frames (input/resize/close).
   * Those carry no reply to await, so without this a dropped keystroke would vanish silently; a
   * subscriber can surface the drop instead (e.g. flag the pane as disconnected).
   */
  subscribeTerminalError(terminalId: string, cb: TerminalErrorCb): Unsubscribe {
    let set = this.terminalErrorSubs.get(terminalId);
    if (!set) {
      set = new Set();
      this.terminalErrorSubs.set(terminalId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
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
    this.terminalOutputSubs.clear();
    this.terminalExitSubs.clear();
    this.terminalErrorSubs.clear();
    this.terminalPrebuffer.clear();
    this.transport.close();
  }

  /** Reject every in-flight request so awaiters get an error instead of hanging forever. */
  private failAllPending(err: Error): void {
    for (const map of [
      this.pendingStarts,
      this.pendingLists,
      this.pendingImports,
      this.pendingHistoryLists,
      this.pendingHistoryReads,
      this.pendingConfigGets,
      this.pendingAcks,
      this.pendingTerminalOpens,
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
    if (rejectFrom(this.pendingImports, replyTo, err)) return;
    if (rejectFrom(this.pendingHistoryLists, replyTo, err)) return;
    if (rejectFrom(this.pendingHistoryReads, replyTo, err)) return;
    if (rejectFrom(this.pendingConfigGets, replyTo, err)) return;
    if (rejectFrom(this.pendingAcks, replyTo, err)) return;
    rejectFrom(this.pendingTerminalOpens, replyTo, err);
  }

  /** Send a fire-and-forget terminal frame, routing any send failure to the terminal's error subs. */
  private sendTerminalFrame(terminalId: string, payload: WirePayload): void {
    const onFail = (err: unknown) => this.emitTerminalError(terminalId, toError(err));
    try {
      void Promise.resolve(this.transport.send(createWireMessage(payload))).catch(onFail);
    } catch (err) {
      onFail(err);
    }
  }

  private emitTerminalError(terminalId: string, err: Error): void {
    const subs = this.terminalErrorSubs.get(terminalId);
    if (subs) for (const cb of subs) cb(err);
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

  private isClosed(): boolean {
    return this.closed;
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
  return new Error(extractErrorMessage(err) ?? 'Unknown error');
}
