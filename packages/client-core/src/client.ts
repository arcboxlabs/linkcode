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
  EffortLevel,
  GitDiff,
  GitDiffMode,
  GitPullRequestStatus,
  GitStatus,
  PermissionOutcome,
  ProvidersConfig,
  SessionId,
  SessionInfo,
  SessionRecord,
  StartOptions,
  WireMessage,
  WirePayload,
  WorkspaceId,
  WorkspaceKind,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * An event paired with its connection-scoped receive sequence number: the Nth `agent.event` this
 * client received for its session (1-based, monotone for the lifetime of the connection). A
 * transcript snapshot taken when the counter read N supersedes exactly the events with seq ≤ N.
 */
export interface SequencedAgentEvent {
  event: AgentEvent;
  seq: number;
}

type EventCb = (event: AgentEvent, seq: number) => void;
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

const EMPTY_EVENTS: readonly SequencedAgentEvent[] = [];

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
  /** Per-session event buffer so a re-subscribe (switching the active session back) can replay the timeline. */
  private readonly events = new Map<SessionId, SequencedAgentEvent[]>();
  /** Cached immutable copies of {@link events}, invalidated per event — `getSnapshot` sources. */
  private readonly eventSnapshots = new Map<SessionId, readonly SequencedAgentEvent[]>();
  /** Per-session receive counters. Deliberately NOT cleared with the buffer on `stopSession`: a
   * stop→resume in the same connection must keep seq monotone, or a seed's `uptoSeq` sampled
   * before the stop would swallow the resumed session's fresh events. */
  private readonly eventSeqs = new Map<SessionId, number>();
  private readonly pendingStarts = new Map<string, Pending<SessionId>>();
  private readonly pendingLists = new Map<string, Pending<SessionInfo[]>>();
  private readonly pendingImports = new Map<string, Pending<SessionRecord>>();
  private readonly pendingHistoryLists = new Map<string, Pending<AgentHistoryListResult>>();
  private readonly pendingHistoryReads = new Map<string, Pending<AgentHistoryReadResult>>();
  private readonly pendingConfigGets = new Map<string, Pending<ProvidersConfig>>();
  private readonly pendingGitStatuses = new Map<string, Pending<GitStatus>>();
  private readonly pendingGitPrStatuses = new Map<string, Pending<GitPullRequestStatus>>();
  private readonly pendingGitDiffs = new Map<string, Pending<GitDiff>>();
  private readonly pendingWorkspaceLists = new Map<string, Pending<WorkspaceRecord[]>>();
  private readonly pendingWorkspaceRegisters = new Map<string, Pending<WorkspaceRecord>>();
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
      case 'git.status.get.result': {
        this.pendingGitStatuses.get(p.replyTo)?.resolve(p.status);
        this.pendingGitStatuses.delete(p.replyTo);
        break;
      }
      case 'git.pr_status.get.result': {
        this.pendingGitPrStatuses.get(p.replyTo)?.resolve(p.prStatus);
        this.pendingGitPrStatuses.delete(p.replyTo);
        break;
      }
      case 'git.diff.get.result': {
        this.pendingGitDiffs.get(p.replyTo)?.resolve(p.diff);
        this.pendingGitDiffs.delete(p.replyTo);
        break;
      }
      case 'workspace.listed': {
        this.pendingWorkspaceLists.get(p.replyTo)?.resolve(p.workspaces);
        this.pendingWorkspaceLists.delete(p.replyTo);
        break;
      }
      case 'workspace.registered': {
        this.pendingWorkspaceRegisters.get(p.replyTo)?.resolve(p.record);
        this.pendingWorkspaceRegisters.delete(p.replyTo);
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
        const seq = (this.eventSeqs.get(p.sessionId) ?? 0) + 1;
        this.eventSeqs.set(p.sessionId, seq);
        const sequenced: SequencedAgentEvent = { event: p.event, seq };
        const buf = this.events.get(p.sessionId);
        if (buf) buf.push(sequenced);
        else this.events.set(p.sessionId, [sequenced]);
        this.eventSnapshots.delete(p.sessionId);
        const subs = this.subscribers.get(p.sessionId);
        if (subs) for (const cb of subs) cb(sequenced.event, sequenced.seq);
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

  /** Switch the session's reasoning-effort level, going forward. Same acceptance rule as setModel. */
  setEffort(sessionId: SessionId, effort: EffortLevel): Promise<RequestAck> {
    return this.send(sessionId, { type: 'set-effort', effort });
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
      this.eventSnapshots.delete(sessionId);
      return ack;
    });
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

  /** Local git facts for a directory (directory-backed: keyed by cwd, not by session). */
  getGitStatus(cwd: string): Promise<GitStatus> {
    return this.sendCorrelated(this.pendingGitStatuses, (clientReqId) => ({
      kind: 'git.status.get',
      clientReqId,
      cwd,
    }));
  }

  /** Hosting-provider PR state for a directory's current branch. */
  getGitPullRequestStatus(cwd: string): Promise<GitPullRequestStatus> {
    return this.sendCorrelated(this.pendingGitPrStatuses, (clientReqId) => ({
      kind: 'git.pr_status.get',
      clientReqId,
      cwd,
    }));
  }

  /** A unified-diff patch for a directory (directory-backed: keyed by cwd, not by session). */
  getGitDiff(cwd: string, mode: GitDiffMode): Promise<GitDiff> {
    return this.sendCorrelated(this.pendingGitDiffs, (clientReqId) => ({
      kind: 'git.diff.get',
      clientReqId,
      cwd,
      mode,
    }));
  }

  /** Every registered workspace (directory), most recently used first. */
  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.sendCorrelated(this.pendingWorkspaceLists, (clientReqId) => ({
      kind: 'workspace.list',
      clientReqId,
    }));
  }

  /** Register a directory as a workspace; idempotent for an already-registered directory. */
  registerWorkspace(cwd: string, name?: string, kind?: WorkspaceKind): Promise<WorkspaceRecord> {
    return this.sendCorrelated(this.pendingWorkspaceRegisters, (clientReqId) => ({
      kind: 'workspace.register',
      clientReqId,
      cwd,
      name,
      workspaceKind: kind,
    }));
  }

  updateWorkspace(workspaceId: WorkspaceId, name: string): Promise<RequestAck> {
    return this.sendCorrelated(this.pendingAcks, (clientReqId) => ({
      kind: 'workspace.update',
      clientReqId,
      workspaceId,
      name,
    }));
  }

  /** Drop a workspace from the registry; never touches the directory on disk. */
  archiveWorkspace(workspaceId: WorkspaceId): Promise<RequestAck> {
    return this.sendCorrelated(this.pendingAcks, (clientReqId) => ({
      kind: 'workspace.archive',
      clientReqId,
      workspaceId,
    }));
  }

  subscribe(sessionId: SessionId, cb: EventCb): Unsubscribe {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(cb);
    // Replay any buffered events (with their original sequence numbers) so a late subscriber sees
    // the full timeline, not a blank pane.
    const buf = this.events.get(sessionId);
    if (buf) for (const { event, seq } of buf) cb(event, seq);
    return () => set.delete(cb);
  }

  /**
   * The receive counter for a session: how many `agent.event`s this client has seen for it on this
   * connection. Sampled right after a transcript read resolves, it becomes that snapshot's
   * `uptoSeq` — the ordered cut "everything at or before this is already in the snapshot".
   */
  eventSeq(sessionId: SessionId): number {
    return this.eventSeqs.get(sessionId) ?? 0;
  }

  /**
   * Immutable snapshot of a session's buffered events, cached until the next event arrives.
   * Stable identity between changes makes it a valid `useSyncExternalStore` getSnapshot source.
   */
  eventsSnapshot(sessionId: SessionId): readonly SequencedAgentEvent[] {
    const cached = this.eventSnapshots.get(sessionId);
    if (cached) return cached;
    const buf = this.events.get(sessionId);
    if (!buf || buf.length === 0) return EMPTY_EVENTS;
    const snapshot: readonly SequencedAgentEvent[] = [...buf];
    this.eventSnapshots.set(sessionId, snapshot);
    return snapshot;
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
    this.eventSnapshots.clear();
    this.eventSeqs.clear();
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
      this.pendingGitStatuses,
      this.pendingGitPrStatuses,
      this.pendingGitDiffs,
      this.pendingWorkspaceLists,
      this.pendingWorkspaceRegisters,
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
    if (rejectFrom(this.pendingGitStatuses, replyTo, err)) return;
    if (rejectFrom(this.pendingGitPrStatuses, replyTo, err)) return;
    if (rejectFrom(this.pendingGitDiffs, replyTo, err)) return;
    if (rejectFrom(this.pendingWorkspaceLists, replyTo, err)) return;
    if (rejectFrom(this.pendingWorkspaceRegisters, replyTo, err)) return;
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
