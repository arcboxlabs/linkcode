import type {
  AgentEvent,
  AgentHistoryId,
  AgentHistoryListResult,
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
  WorkspaceFile,
  WorkspaceId,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceScript,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import type { HistoryListClientOptions, HistoryReadClientOptions } from './client/control-channel';
import { ControlChannel } from './client/control-channel';
import type { SequencedAgentEvent } from './client/event-buffer';
import { EventBuffer } from './client/event-buffer';
import type { RequestAck } from './client/pending-registry';
import { PendingRegistry } from './client/pending-registry';
import { TerminalChannel } from './client/terminal-channel';

export type { HistoryListClientOptions, HistoryReadClientOptions } from './client/control-channel';
export type { SequencedAgentEvent } from './client/event-buffer';

type EventCb = (event: AgentEvent, seq: number) => void;
type TerminalOutputCb = (data: string) => void;
type ScriptStatusCb = (cwd: string, script: WorkspaceScript) => void;
type TerminalExitCb = (exitCode: number | null) => void;
type TerminalErrorCb = (err: Error) => void;

/**
 * LinkCodeClient: the data-plane client shared across all platforms
 * (docs/ARCHITECTURE.md#packages--repo-layout).
 * Layers session semantics (start / prompt / subscribe / stop) on top of any Transport, agnostic to
 * whether it's a LocalTransport or a WsTransport to the daemon (docs/ARCHITECTURE.md#core-principles).
 *
 * The daemon broadcasts events to every client, so control replies are paired by correlation id rather
 * than by order: each request carries a `clientReqId` and the reply echoes it as `replyTo`. Composed
 * from four collaborators: a {@link PendingRegistry} for correlated request/reply bookkeeping, a
 * {@link ControlChannel} for session/history/config/git/workspace requests, an {@link EventBuffer}
 * for per-session agent events, and a {@link TerminalChannel} for PTY sessions.
 */
export class LinkCodeClient {
  private readonly pending = new PendingRegistry();
  private readonly control: ControlChannel;
  private readonly events = new EventBuffer();
  private readonly terminals: TerminalChannel;
  private readonly scriptStatusSubs = new Set<ScriptStatusCb>();
  private unsub: Unsubscribe | null = null;
  private offClose: Unsubscribe | null = null;
  private closed = false;

  constructor(private readonly transport: Transport) {
    this.control = new ControlChannel(transport, this.pending);
    this.terminals = new TerminalChannel(transport, this.pending);
  }

  async connect(): Promise<void> {
    this.closed = false;
    await this.transport.connect();
    // The caller's effect may have been torn down mid-await (React StrictMode / remount); bail if so.
    if (this.isClosed()) return;
    this.unsub?.();
    this.unsub = this.transport.onMessage((msg) => this.route(msg));
    this.offClose?.();
    this.offClose = this.transport.onClose(() =>
      this.pending.failAll(new Error('transport connection closed')),
    );
  }

  private route(msg: WireMessage): void {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.started':
        this.pending.resolve('start', p.replyTo, p.sessionId);
        break;
      case 'session.listed':
        this.pending.resolve('list', p.replyTo, p.sessions);
        break;
      case 'session.imported':
        this.pending.resolve('import', p.replyTo, p.record);
        break;
      case 'history.listed':
        this.pending.resolve('historyList', p.replyTo, p.result);
        break;
      case 'history.read.result':
        this.pending.resolve('historyRead', p.replyTo, p.result);
        break;
      case 'config.get.result':
        this.pending.resolve('configGet', p.replyTo, p.providers);
        break;
      case 'git.status.get.result':
        this.pending.resolve('gitStatus', p.replyTo, p.status);
        break;
      case 'git.pr_status.get.result':
        this.pending.resolve('gitPrStatus', p.replyTo, p.prStatus);
        break;
      case 'git.diff.get.result':
        this.pending.resolve('gitDiff', p.replyTo, p.diff);
        break;
      case 'file.read.result':
        this.pending.resolve('fileRead', p.replyTo, p.file);
        break;
      case 'script.listed':
        this.pending.resolve('scriptList', p.replyTo, p.scripts);
        break;
      case 'script.status':
        for (const cb of this.scriptStatusSubs) cb(p.cwd, p.script);
        break;
      case 'workspace.listed':
        this.pending.resolve('workspaceList', p.replyTo, p.workspaces);
        break;
      case 'workspace.registered':
        this.pending.resolve('workspaceRegister', p.replyTo, p.record);
        break;
      case 'request.failed': {
        const err = new Error(p.message);
        if (p.code) Object.assign(err, { code: p.code });
        this.pending.reject(p.replyTo, err);
        break;
      }
      case 'request.succeeded':
        this.pending.resolve('ack', p.replyTo, { ok: true });
        break;
      case 'agent.event':
        this.events.ingest(p.sessionId, p.event);
        break;
      case 'terminal.opened':
      case 'terminal.output':
      case 'terminal.exit':
        this.terminals.handleMessage(p);
        break;
      default:
        break;
    }
  }

  startSession(opts: StartOptions): Promise<SessionId> {
    return this.control.startSession(opts);
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.control.listSessions();
  }

  resumeSession(sessionId: SessionId): Promise<SessionId> {
    return this.control.resumeSession(sessionId);
  }

  importSession(agentKind: AgentKind, historyId: AgentHistoryId): Promise<SessionRecord> {
    return this.control.importSession(agentKind, historyId);
  }

  listHistory(
    agentKind: AgentKind,
    opts?: HistoryListClientOptions,
  ): Promise<AgentHistoryListResult> {
    return this.control.listHistory(agentKind, opts);
  }

  readHistory(
    agentKind: AgentKind,
    opts: HistoryReadClientOptions,
  ): Promise<AgentHistoryReadResult> {
    return this.control.readHistory(agentKind, opts);
  }

  resumeHistory(
    agentKind: AgentKind,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): Promise<SessionId> {
    return this.control.resumeHistory(agentKind, historyId, startOpts);
  }

  /** Low-level: send any normalized input to a session. */
  send(sessionId: SessionId, input: AgentInput): Promise<RequestAck> {
    return this.control.send(sessionId, input);
  }

  prompt(sessionId: SessionId, content: ContentBlock[]): Promise<RequestAck> {
    return this.control.prompt(sessionId, content);
  }

  promptText(sessionId: SessionId, text: string): Promise<RequestAck> {
    return this.control.promptText(sessionId, text);
  }

  cancel(sessionId: SessionId): Promise<RequestAck> {
    return this.control.cancel(sessionId);
  }

  setMode(sessionId: SessionId, modeId: string): Promise<RequestAck> {
    return this.control.setMode(sessionId, modeId);
  }

  setModel(sessionId: SessionId, model: string): Promise<RequestAck> {
    return this.control.setModel(sessionId, model);
  }

  setEffort(sessionId: SessionId, effort: EffortLevel): Promise<RequestAck> {
    return this.control.setEffort(sessionId, effort);
  }

  respondPermission(
    sessionId: SessionId,
    requestId: string,
    outcome: PermissionOutcome,
  ): Promise<RequestAck> {
    return this.control.respondPermission(sessionId, requestId, outcome);
  }

  /** Stop a session and drop its buffered events (its receive counter survives, see {@link EventBuffer}). */
  stopSession(sessionId: SessionId): Promise<RequestAck> {
    return this.control.stopSession(sessionId).then((ack) => {
      this.events.clearSession(sessionId);
      return ack;
    });
  }

  /** Stop the session if live and remove its persisted record; provider-local history stays re-importable. */
  deleteSession(sessionId: SessionId): Promise<RequestAck> {
    return this.control.deleteSession(sessionId).then((ack) => {
      this.events.clearSession(sessionId);
      return ack;
    });
  }

  getProviderConfig(): Promise<ProvidersConfig> {
    return this.control.getProviderConfig();
  }

  setProviderConfig(providers: ProvidersConfig): Promise<RequestAck> {
    return this.control.setProviderConfig(providers);
  }

  getGitStatus(cwd: string): Promise<GitStatus> {
    return this.control.getGitStatus(cwd);
  }

  getGitPullRequestStatus(cwd: string): Promise<GitPullRequestStatus> {
    return this.control.getGitPullRequestStatus(cwd);
  }

  getGitDiff(cwd: string, mode: GitDiffMode): Promise<GitDiff> {
    return this.control.getGitDiff(cwd, mode);
  }

  /** Read a file contained to a workspace directory (directory-backed, like git.*). */
  readFile(cwd: string, path: string): Promise<WorkspaceFile> {
    return this.control.readFile(cwd, path);
  }

  /** The workspace's declared scripts with live lifecycle/health (directory-backed). */
  listScripts(cwd: string): Promise<WorkspaceScript[]> {
    return this.control.listScripts(cwd);
  }

  /** Start a declared script; state changes stream via {@link subscribeScriptStatus}. */
  startScript(cwd: string, scriptName: string): Promise<RequestAck> {
    return this.control.startScript(cwd, scriptName);
  }

  stopScript(cwd: string, scriptName: string): Promise<RequestAck> {
    return this.control.stopScript(cwd, scriptName);
  }

  /** Broadcast `script.status` updates for every workspace (callers filter by cwd). */
  subscribeScriptStatus(cb: ScriptStatusCb): Unsubscribe {
    this.scriptStatusSubs.add(cb);
    return () => this.scriptStatusSubs.delete(cb);
  }

  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.control.listWorkspaces();
  }

  registerWorkspace(cwd: string, name?: string, kind?: WorkspaceKind): Promise<WorkspaceRecord> {
    return this.control.registerWorkspace(cwd, name, kind);
  }

  updateWorkspace(workspaceId: WorkspaceId, name: string): Promise<RequestAck> {
    return this.control.updateWorkspace(workspaceId, name);
  }

  archiveWorkspace(workspaceId: WorkspaceId): Promise<RequestAck> {
    return this.control.archiveWorkspace(workspaceId);
  }

  subscribe(sessionId: SessionId, cb: EventCb): Unsubscribe {
    return this.events.subscribe(sessionId, cb);
  }

  eventSeq(sessionId: SessionId): number {
    return this.events.eventSeq(sessionId);
  }

  eventsSnapshot(sessionId: SessionId): readonly SequencedAgentEvent[] {
    return this.events.snapshot(sessionId);
  }

  openTerminal(opts: {
    cols: number;
    rows: number;
    cwd?: string;
    shell?: string;
    sessionId?: SessionId;
  }): Promise<string> {
    return this.terminals.open(opts);
  }

  terminalInput(terminalId: string, data: string): void {
    this.terminals.input(terminalId, data);
  }

  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    this.terminals.resize(terminalId, cols, rows);
  }

  closeTerminal(terminalId: string): void {
    this.terminals.close(terminalId);
  }

  subscribeTerminalOutput(terminalId: string, cb: TerminalOutputCb): Unsubscribe {
    return this.terminals.subscribeOutput(terminalId, cb);
  }

  subscribeTerminalExit(terminalId: string, cb: TerminalExitCb): Unsubscribe {
    return this.terminals.subscribeExit(terminalId, cb);
  }

  /** Observe transport-send failures for a terminal's fire-and-forget frames (input/resize/close). */
  subscribeTerminalError(terminalId: string, cb: TerminalErrorCb): Unsubscribe {
    return this.terminals.subscribeError(terminalId, cb);
  }

  /** See {@link TerminalChannel.outputSnapshot}. */
  terminalOutputSnapshot(terminalId: string): string {
    return this.terminals.outputSnapshot(terminalId);
  }

  /** See {@link TerminalChannel.subscribeOutputSnapshot}. */
  subscribeTerminalOutputSnapshot(terminalId: string, cb: () => void): Unsubscribe {
    return this.terminals.subscribeOutputSnapshot(terminalId, cb);
  }

  dispose(): void {
    this.closed = true;
    this.unsub?.();
    this.unsub = null;
    this.offClose?.();
    this.offClose = null;
    this.pending.failAll(new Error('client disposed'));
    this.events.clearAll();
    this.terminals.disposeAll();
    this.transport.close();
  }

  private isClosed(): boolean {
    return this.closed;
  }
}
