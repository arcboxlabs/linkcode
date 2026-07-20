import type {
  Accounts,
  AgentEvent,
  AgentHistoryId,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
  AgentRuntimes,
  ContentBlock,
  EffortLevel,
  FileSuggestion,
  GitDiff,
  GitDiffMode,
  GitPullRequestStatus,
  GitStatus,
  HostedArtifact,
  HostedFile,
  InstalledAsset,
  LoopId,
  LoopInspection,
  LoopIteration,
  LoopLogEntry,
  LoopRecord,
  LoopSpec,
  ManagedAssetId,
  ManagedAssetStatus,
  PermissionOutcome,
  ProvidersConfig,
  QuestionOutcome,
  Schedule,
  ScheduleId,
  ScheduleRun,
  ScheduleSpec,
  ScheduleUpdate,
  SessionId,
  SessionInfo,
  SessionNotification,
  SessionRecord,
  StartOptions,
  TerminalMetadata,
  TerminalReplayEvent,
  WireMessage,
  WorkspaceFile,
  WorkspaceId,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceScript,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import type { AgentLoginHandlers } from './client/agent-login-channel';
import { AgentLoginChannel } from './client/agent-login-channel';
import type { HistoryListClientOptions, HistoryReadClientOptions } from './client/control-channel';
import { ControlChannel } from './client/control-channel';
import type { SequencedAgentEvent } from './client/event-buffer';
import { EventBuffer } from './client/event-buffer';
import { LoopLogBuffer } from './client/loop-log-buffer';
import type { RandomUUID, RequestAck } from './client/pending-registry';
import { PendingRegistry, resolveRandomUUID } from './client/pending-registry';
import { TerminalChannel } from './client/terminal-channel';

export type { AgentLoginHandlers, AgentLoginSettled } from './client/agent-login-channel';
export type { HistoryListClientOptions, HistoryReadClientOptions } from './client/control-channel';
export type { SequencedAgentEvent } from './client/event-buffer';

type EventCb = (event: AgentEvent, seq: number) => void;
type TerminalOutputCb = (data: string) => void;
type TerminalEventCb = (event: TerminalReplayEvent) => void;
type ScriptStatusCb = (cwd: string, script: WorkspaceScript) => void;
type SessionNotificationCb = (notification: SessionNotification) => void;
type TerminalExitCb = (exitCode: number | null) => void;
type TerminalErrorCb = (err: Error) => void;
type TerminalControllerCb = (canControl: boolean) => void;
type TerminalReplayTruncatedCb = (truncated: boolean) => void;

export interface LinkCodeClientOptions {
  randomUUID?: RandomUUID;
}

export interface TerminalAttachResult {
  terminal: TerminalMetadata;
  truncated: boolean;
}

/** One `asset.progress` broadcast: bytes received so far for an in-flight managed install. */
export interface AssetProgressEvent {
  id: ManagedAssetId;
  receivedBytes: number;
  totalBytes?: number;
}

/** One `asset.settled` broadcast: `installed` on success, `error` message on failure. */
export interface AssetSettledEvent {
  id: ManagedAssetId;
  installed?: InstalledAsset;
  error?: string;
}

type AssetProgressCb = (event: AssetProgressEvent) => void;
type AssetSettledCb = (event: AssetSettledEvent) => void;
type AgentRuntimesChangedCb = (runtimes: AgentRuntimes) => void;
type ConnectionCloseCb = (error: Error) => void;

/** A broadcast about a schedule's or its runs' state — the three `schedule.*` push variants. */
export type ScheduleEvent =
  | { type: 'changed'; schedule: Schedule }
  | { type: 'removed'; scheduleId: ScheduleId }
  | { type: 'run'; run: ScheduleRun };
type ScheduleEventCb = (event: ScheduleEvent) => void;

/** A broadcast about a loop's or its iterations' state. Live log lines route to the log buffer, not here. */
export type LoopEvent =
  | { type: 'changed'; loop: LoopRecord }
  | { type: 'removed'; loopId: LoopId }
  | { type: 'iteration'; iteration: LoopIteration };
type LoopEventCb = (event: LoopEvent) => void;
type ConnectionState = 'idle' | 'connecting' | 'ready' | 'closed' | 'disposed';

const HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * Cross-platform data-plane client: session semantics over any Transport
 * (docs/ARCHITECTURE.md#packages--repo-layout, #core-principles). Owns one transport generation;
 * ready only after the LinkCode ping/pong handshake. The daemon broadcasts to every client, so
 * control replies pair by correlation id (`clientReqId` echoed as `replyTo`), never by order.
 */
export class LinkCodeClient {
  private readonly pending: PendingRegistry;
  private readonly control: ControlChannel;
  private readonly events = new EventBuffer();
  private readonly terminals: TerminalChannel;
  private readonly agentLogin: AgentLoginChannel;
  private readonly scriptStatusSubs = new Set<ScriptStatusCb>();
  private readonly scheduleEventSubs = new Set<ScheduleEventCb>();
  private readonly loopEventSubs = new Set<LoopEventCb>();
  private readonly loopLogs = new LoopLogBuffer();
  private readonly sessionNotificationSubs = new Set<SessionNotificationCb>();
  private readonly assetProgressSubs = new Set<AssetProgressCb>();
  private readonly assetSettledSubs = new Set<AssetSettledCb>();
  private readonly agentRuntimesChangedSubs = new Set<AgentRuntimesChangedCb>();
  private readonly connectionCloseSubs = new Set<ConnectionCloseCb>();
  private unsub: Unsubscribe | null = null;
  private offClose: Unsubscribe | null = null;
  private state: ConnectionState = 'idle';
  private connectionError: Error | null = null;
  private resolveHandshake: (() => void) | null = null;
  private rejectHandshake: ((error: Error) => void) | null = null;

  constructor(
    private readonly transport: Transport,
    options: LinkCodeClientOptions = {},
  ) {
    const randomUUID = resolveRandomUUID(options.randomUUID);
    this.pending = new PendingRegistry(randomUUID);
    this.control = new ControlChannel(transport, this.pending);
    this.terminals = new TerminalChannel(transport, this.pending, randomUUID);
    this.agentLogin = new AgentLoginChannel(transport, this.pending);
  }

  async connect(): Promise<void> {
    if (this.state === 'disposed') throw new Error('LinkCodeClient: client disposed');
    if (this.state !== 'idle') {
      throw new Error('LinkCodeClient: connection already started');
    }
    this.state = 'connecting';
    this.unsub = this.transport.onMessage((msg) => this.route(msg));
    this.offClose = this.transport.onClose(() => this.handleTransportClose());

    try {
      await this.transport.connect();
      this.throwIfNotConnecting();
      await this.handshake();
      this.throwIfNotConnecting();
      this.state = 'ready';
    } catch (error_) {
      const disposed = this.isDisposed();
      const error = disposed ? new Error('client disposed') : toError(error_);
      if (!disposed) this.state = 'closed';
      this.connectionError = error;
      this.pending.failAll(error);
      this.clearTransportSubscriptions();
      await this.transport.close();
      throw error;
    }
  }

  /** Observe an unexpected close after this client has completed its LinkCode handshake. */
  onClose(cb: ConnectionCloseCb): Unsubscribe {
    this.connectionCloseSubs.add(cb);
    return () => this.connectionCloseSubs.delete(cb);
  }

  private async handshake(): Promise<void> {
    let settled = false;
    let cancelTimer: () => void = noop;
    const pong = new Promise<void>((resolve, reject) => {
      const clear = (): void => {
        cancelTimer();
        this.resolveHandshake = null;
        this.rejectHandshake = null;
      };
      this.resolveHandshake = () => {
        if (settled) return;
        settled = true;
        clear();
        resolve();
      };
      this.rejectHandshake = (error) => {
        if (settled) return;
        settled = true;
        clear();
        reject(error);
      };
      const timer = setTimeout(() => {
        this.rejectHandshake?.(
          new Error(
            `LinkCodeClient: handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms; daemon unavailable or wire protocol mismatch`,
          ),
        );
      }, HANDSHAKE_TIMEOUT_MS);
      cancelTimer = () => clearTimeout(timer);
    });

    let sent: Promise<void>;
    try {
      sent = Promise.resolve(this.transport.send(createWireMessage({ kind: 'ping' })));
    } catch (error) {
      sent = Promise.reject(toError(error));
    }

    try {
      await Promise.all([sent, pong]);
    } finally {
      cancelTimer();
      this.resolveHandshake = null;
      this.rejectHandshake = null;
    }
  }

  private handleTransportClose(): void {
    if (this.state === 'closed' || this.state === 'disposed') return;
    const wasReady = this.state === 'ready';
    const error = new Error('transport connection closed');
    this.state = 'closed';
    this.connectionError = error;
    this.rejectHandshake?.(error);
    this.pending.failAll(error);
    this.clearTransportSubscriptions();

    if (wasReady) {
      const subscribers = [...this.connectionCloseSubs];
      this.connectionCloseSubs.clear();
      for (const cb of subscribers) cb(error);
    }
  }

  private throwIfNotConnecting(): void {
    if (this.state === 'connecting') return;
    if (this.state === 'disposed') throw new Error('client disposed');
    throw this.connectionError ?? new Error('transport connection closed');
  }

  private isDisposed(): boolean {
    return this.state === 'disposed';
  }

  private clearTransportSubscriptions(): void {
    this.unsub?.();
    this.unsub = null;
    this.offClose?.();
    this.offClose = null;
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
        // One result carries both; each resolve is a no-op unless a request awaits that reply id.
        this.pending.resolve('configGet', p.replyTo, p.providers);
        this.pending.resolve('accountsGet', p.replyTo, p.accounts);
        break;
      case 'agent-runtime.listed':
        this.pending.resolve('agentRuntimeList', p.replyTo, p.runtimes);
        break;
      case 'agent-runtime.changed':
        for (const cb of this.agentRuntimesChangedSubs) cb(p.runtimes);
        break;
      case 'asset.listed':
        this.pending.resolve('assetList', p.replyTo, p.assets);
        break;
      case 'asset.ensured':
        this.pending.resolve('assetEnsure', p.replyTo, p.status);
        break;
      case 'asset.progress':
        for (const cb of this.assetProgressSubs) {
          cb({ id: p.id, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes });
        }
        break;
      case 'asset.settled':
        for (const cb of this.assetSettledSubs) {
          cb({ id: p.id, installed: p.installed, error: p.error });
        }
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
      case 'file.list.result':
        this.pending.resolve('fileList', p.replyTo, p.files);
        break;
      case 'file.suggest.result':
        this.pending.resolve('fileSuggest', p.replyTo, p.suggestions);
        break;
      case 'script.listed':
        this.pending.resolve('scriptList', p.replyTo, p.scripts);
        break;
      case 'artifact.hosted':
        this.pending.resolve('artifactHost', p.replyTo, p.artifact);
        break;
      case 'file.hosted':
        this.pending.resolve('fileHost', p.replyTo, p.hosted);
        break;
      case 'script.status':
        for (const cb of this.scriptStatusSubs) cb(p.cwd, p.script);
        break;
      case 'schedule.created':
        this.pending.resolve('scheduleCreate', p.replyTo, p.schedule);
        break;
      case 'schedule.updated':
        this.pending.resolve('scheduleUpdate', p.replyTo, p.schedule);
        break;
      case 'schedule.listed':
        this.pending.resolve('scheduleList', p.replyTo, p.schedules);
        break;
      case 'schedule.runs.listed':
        this.pending.resolve('scheduleRuns', p.replyTo, p.runs);
        break;
      case 'schedule.changed':
        for (const cb of this.scheduleEventSubs) cb({ type: 'changed', schedule: p.schedule });
        break;
      case 'schedule.removed':
        for (const cb of this.scheduleEventSubs) cb({ type: 'removed', scheduleId: p.scheduleId });
        break;
      case 'schedule.run':
        for (const cb of this.scheduleEventSubs) cb({ type: 'run', run: p.run });
        break;
      case 'loop.started':
        this.pending.resolve('loopStart', p.replyTo, p.loop);
        break;
      case 'loop.listed':
        this.pending.resolve('loopList', p.replyTo, p.loops);
        break;
      case 'loop.inspected':
        this.loopLogs.seed(p.loop.loopId, p.logs);
        this.pending.resolve('loopInspect', p.replyTo, {
          loop: p.loop,
          iterations: p.iterations,
          logs: p.logs,
        });
        break;
      case 'loop.changed':
        for (const cb of this.loopEventSubs) cb({ type: 'changed', loop: p.loop });
        break;
      case 'loop.removed':
        for (const cb of this.loopEventSubs) cb({ type: 'removed', loopId: p.loopId });
        break;
      case 'loop.iteration':
        for (const cb of this.loopEventSubs) cb({ type: 'iteration', iteration: p.iteration });
        break;
      case 'loop.log':
        this.loopLogs.ingest(p.loopId, p.entry);
        break;
      case 'session.notification':
        for (const cb of this.sessionNotificationSubs) cb(p.notification);
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
      case 'terminal.listed':
      case 'terminal.opened':
      case 'terminal.attached':
      case 'terminal.output':
      case 'terminal.resized':
      case 'terminal.controller.changed':
      case 'terminal.exit':
        this.terminals.handleMessage(p);
        break;
      case 'agent-login.started':
      case 'agent-login.url':
      case 'agent-login.settled':
        this.agentLogin.handleMessage(p);
        break;
      case 'pong':
        this.resolveHandshake?.();
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

  invokeCommand(sessionId: SessionId, name: string, args?: string): Promise<RequestAck> {
    return this.control.invokeCommand(sessionId, name, args);
  }

  runShellCommand(sessionId: SessionId, command: string): Promise<RequestAck> {
    return this.control.runShellCommand(sessionId, command);
  }

  cancel(sessionId: SessionId): Promise<RequestAck> {
    return this.control.cancel(sessionId);
  }

  setMode(sessionId: SessionId, modeId: string): Promise<RequestAck> {
    return this.control.setMode(sessionId, modeId);
  }

  setApprovalPolicy(sessionId: SessionId, policyId: string): Promise<RequestAck> {
    return this.control.setApprovalPolicy(sessionId, policyId);
  }

  /** See {@link ControlChannel.attachSession}. */
  attachSession(sessionId: SessionId): void {
    this.control.attachSession(sessionId);
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

  respondQuestion(
    sessionId: SessionId,
    requestId: string,
    outcome: QuestionOutcome,
  ): Promise<RequestAck> {
    return this.control.respondQuestion(sessionId, requestId, outcome);
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

  getAccounts(): Promise<Accounts> {
    return this.control.getAccounts();
  }

  listAgentRuntimes(): Promise<AgentRuntimes> {
    return this.control.listAgentRuntimes();
  }

  listAssets(): Promise<ManagedAssetStatus[]> {
    return this.control.listAssets();
  }

  /** Install a managed asset; resolves when the install settles (see ControlChannel.ensureAsset). */
  ensureAsset(id: ManagedAssetId): Promise<ManagedAssetStatus> {
    return this.control.ensureAsset(id);
  }

  /** Broadcast download progress for every in-flight managed install (callers filter by id). */
  subscribeAssetProgress(cb: AssetProgressCb): Unsubscribe {
    this.assetProgressSubs.add(cb);
    return () => this.assetProgressSubs.delete(cb);
  }

  /** Broadcast terminal state of managed installs, including boot-triggered background ones. */
  subscribeAssetSettled(cb: AssetSettledCb): Unsubscribe {
    this.assetSettledSubs.add(cb);
    return () => this.assetSettledSubs.delete(cb);
  }

  /** Pushed whenever the daemon re-probes agent runtimes (a managed agent install landed). */
  subscribeAgentRuntimesChanged(cb: AgentRuntimesChangedCb): Unsubscribe {
    this.agentRuntimesChangedSubs.add(cb);
    return () => this.agentRuntimesChangedSubs.delete(cb);
  }

  setProviderConfig(providers: ProvidersConfig): Promise<RequestAck> {
    return this.control.setProviderConfig(providers);
  }

  setAccounts(accounts: Accounts): Promise<RequestAck> {
    return this.control.setAccounts(accounts);
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

  /** Every workspace file as a cwd-relative path. Like file.suggest, `cwd` must be a
   * registered workspace root (session start/resume registers it); unknown roots are rejected. */
  listFiles(cwd: string): Promise<string[]> {
    return this.control.listFiles(cwd);
  }

  /** Search workspace files by substring query. Unlike file.read/git.*, `cwd` must be a
   * registered workspace root (session start/resume registers it); unknown roots are rejected. */
  suggestFiles(cwd: string, query: string, limit?: number): Promise<FileSuggestion[]> {
    return this.control.suggestFiles(cwd, query, limit);
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

  /** Broadcast `session.notification` moments for every session, foreground or background. */
  subscribeSessionNotification(cb: SessionNotificationCb): Unsubscribe {
    this.sessionNotificationSubs.add(cb);
    return () => this.sessionNotificationSubs.delete(cb);
  }

  /** Host inline artifact content on the daemon's ephemeral per-artifact origin. */
  hostArtifact(content: string, mimeType: string): Promise<HostedArtifact> {
    return this.control.hostArtifact(content, mimeType);
  }

  /** Host a workspace file on the daemon's per-file origin, streamed with Range (CODE-316). */
  hostFile(cwd: string, path: string): Promise<HostedFile> {
    return this.control.hostFile(cwd, path);
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

  createSchedule(spec: ScheduleSpec): Promise<Schedule> {
    return this.control.createSchedule(spec);
  }

  updateSchedule(scheduleId: ScheduleId, patch: ScheduleUpdate): Promise<Schedule> {
    return this.control.updateSchedule(scheduleId, patch);
  }

  deleteSchedule(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.control.deleteSchedule(scheduleId);
  }

  pauseSchedule(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.control.pauseSchedule(scheduleId);
  }

  resumeSchedule(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.control.resumeSchedule(scheduleId);
  }

  runScheduleOnce(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.control.runScheduleOnce(scheduleId);
  }

  listSchedules(): Promise<Schedule[]> {
    return this.control.listSchedules();
  }

  listScheduleRuns(scheduleId: ScheduleId, limit?: number): Promise<ScheduleRun[]> {
    return this.control.listScheduleRuns(scheduleId, limit);
  }

  /** Fold `schedule.changed` / `schedule.removed` / `schedule.run` broadcasts (e.g. to revalidate). */
  subscribeScheduleEvents(cb: ScheduleEventCb): Unsubscribe {
    this.scheduleEventSubs.add(cb);
    return () => this.scheduleEventSubs.delete(cb);
  }

  startLoop(spec: LoopSpec): Promise<LoopRecord> {
    return this.control.startLoop(spec);
  }

  stopLoop(loopId: LoopId): Promise<RequestAck> {
    return this.control.stopLoop(loopId);
  }

  deleteLoop(loopId: LoopId): Promise<RequestAck> {
    return this.control.deleteLoop(loopId);
  }

  listLoops(): Promise<LoopRecord[]> {
    return this.control.listLoops();
  }

  /** A loop's record + iterations + log tail; also seeds the client's log buffer for the loop. */
  inspectLoop(loopId: LoopId): Promise<LoopInspection> {
    return this.control.inspectLoop(loopId);
  }

  /** Fold `loop.changed` / `loop.removed` / `loop.iteration` broadcasts (e.g. to revalidate). */
  subscribeLoopEvents(cb: LoopEventCb): Unsubscribe {
    this.loopEventSubs.add(cb);
    return () => this.loopEventSubs.delete(cb);
  }

  /** Stable log-tail snapshot for a loop (pairs with {@link subscribeLoopLog} for useSyncExternalStore). */
  loopLogSnapshot(loopId: LoopId): readonly LoopLogEntry[] {
    return this.loopLogs.snapshot(loopId);
  }

  subscribeLoopLog(loopId: LoopId, cb: () => void): Unsubscribe {
    return this.loopLogs.subscribe(loopId, cb);
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
  }): Promise<string> {
    return this.terminals.open(opts);
  }

  listTerminals(): Promise<TerminalMetadata[]> {
    return this.terminals.list();
  }

  /** Retain a shared, read-only attachment to an existing terminal. */
  attachTerminal(terminalId: string): Promise<TerminalAttachResult> {
    return this.terminals.attach(terminalId);
  }

  /** Upgrade this connection's existing attachment to the terminal controller. */
  takeTerminalControl(terminalId: string): Promise<TerminalAttachResult> {
    return this.terminals.takeControl(terminalId);
  }

  detachTerminal(terminalId: string): void {
    this.terminals.detach(terminalId);
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

  subscribeTerminalEvents(terminalId: string, cb: TerminalEventCb): Unsubscribe {
    return this.terminals.subscribeEvents(terminalId, cb);
  }

  subscribeTerminalExit(terminalId: string, cb: TerminalExitCb): Unsubscribe {
    return this.terminals.subscribeExit(terminalId, cb);
  }

  /** Observe transport-send failures for a terminal's fire-and-forget frames (input/resize/close). */
  subscribeTerminalError(terminalId: string, cb: TerminalErrorCb): Unsubscribe {
    return this.terminals.subscribeError(terminalId, cb);
  }

  terminalCanControl(terminalId: string): boolean {
    return this.terminals.canControl(terminalId);
  }

  subscribeTerminalController(terminalId: string, cb: TerminalControllerCb): Unsubscribe {
    return this.terminals.subscribeController(terminalId, cb);
  }

  terminalReplayWasTruncated(terminalId: string): boolean {
    return this.terminals.replayWasTruncated(terminalId);
  }

  subscribeTerminalReplayTruncated(terminalId: string, cb: TerminalReplayTruncatedCb): Unsubscribe {
    return this.terminals.subscribeReplayTruncated(terminalId, cb);
  }

  /** See {@link TerminalChannel.outputSnapshot}. */
  terminalOutputSnapshot(terminalId: string): string {
    return this.terminals.outputSnapshot(terminalId);
  }

  /** See {@link TerminalChannel.subscribeOutputSnapshot}. */
  subscribeTerminalOutputSnapshot(terminalId: string, cb: () => void): Unsubscribe {
    return this.terminals.subscribeOutputSnapshot(terminalId, cb);
  }

  /** Begin an interactive provider login (claude-code); resolves the loginId to subscribe against. */
  startAgentLogin(agent: AgentKind): Promise<string> {
    return this.agentLogin.start(agent);
  }

  /** Observe the browser URL and terminal outcome of a login started with {@link startAgentLogin}. */
  subscribeAgentLogin(loginId: string, handlers: AgentLoginHandlers): Unsubscribe {
    return this.agentLogin.subscribe(loginId, handlers);
  }

  /** Feed the authorization code the user pasted from the browser back to the login. */
  submitLoginCode(loginId: string, code: string): void {
    this.agentLogin.submitCode(loginId, code);
  }

  cancelAgentLogin(loginId: string): void {
    this.agentLogin.cancel(loginId);
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    const error = new Error('client disposed');
    this.rejectHandshake?.(error);
    this.clearTransportSubscriptions();
    this.connectionCloseSubs.clear();
    this.pending.failAll(error);
    this.events.clearAll();
    this.loopLogs.clear();
    this.terminals.disposeAll();
    this.agentLogin.disposeAll();
    this.transport.close();
  }
}

function toError(error: unknown): Error {
  return new Error(extractErrorMessage(error, false) ?? 'Unknown error', { cause: error });
}
