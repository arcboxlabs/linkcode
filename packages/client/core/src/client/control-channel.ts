import type {
  Accounts,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
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
  LoopId,
  LoopInspection,
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
  SessionRecord,
  StartOptions,
  WirePayload,
  WorkspaceFile,
  WorkspaceId,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceScript,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { PendingRegistry, PendingValueMap, RequestAck } from './pending-registry';
import { sendCorrelated } from './pending-registry';

export type HistoryListClientOptions = AgentHistoryListOptions & {
  forceRefresh?: boolean;
};

export type HistoryReadClientOptions = AgentHistoryReadOptions & {
  forceRefresh?: boolean;
};

/**
 * Correlated control-plane requests (sessions, history, config, git, workspaces); replies are
 * correlated via the shared {@link PendingRegistry} (see {@link sendCorrelated}).
 */
export class ControlChannel {
  constructor(
    private readonly transport: Transport,
    private readonly pending: PendingRegistry,
  ) {}

  startSession(opts: StartOptions): Promise<SessionId> {
    return this.sendCorrelated('start', (clientReqId) => ({
      kind: 'session.start',
      clientReqId,
      opts,
    }));
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.sendCorrelated('list', (clientReqId) => ({ kind: 'session.list', clientReqId }));
  }

  /** Resume a persisted (cold) session by its Link Code id; resolves with the same id. */
  resumeSession(sessionId: SessionId): Promise<SessionId> {
    return this.sendCorrelated('start', (clientReqId) => ({
      kind: 'session.resume',
      clientReqId,
      sessionId,
    }));
  }

  /** Import a provider-local history session as a cold record (listed, not started). */
  importSession(agentKind: AgentKind, historyId: AgentHistoryId): Promise<SessionRecord> {
    return this.sendCorrelated('import', (clientReqId) => ({
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
    return this.sendCorrelated('historyList', (clientReqId) => ({
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
    return this.sendCorrelated('historyRead', (clientReqId) => ({
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
    return this.sendCorrelated('start', (clientReqId) => ({
      kind: 'history.resume',
      clientReqId,
      agentKind,
      historyId,
      startOpts: { ...startOpts, kind: agentKind },
    }));
  }

  /** Low-level: send any normalized input to a session. */
  send(sessionId: SessionId, input: AgentInput): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
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

  /** Invoke a provider slash command by name. The host rejects unsupported commands and misses
   * from an authoritative catalog; while discovery is loading, the provider validates the name. */
  invokeCommand(sessionId: SessionId, name: string, args?: string): Promise<RequestAck> {
    return this.send(sessionId, { type: 'command', name, arguments: args });
  }

  /** Run a raw shell command in the session's cwd, outside the model loop (the user's `$` input).
   * Rejects if the adapter's provider has no shell passthrough. */
  runShellCommand(sessionId: SessionId, command: string): Promise<RequestAck> {
    return this.send(sessionId, { type: 'shell-command', command });
  }

  /** Cancel the in-flight turn. */
  cancel(sessionId: SessionId): Promise<RequestAck> {
    return this.send(sessionId, { type: 'cancel' });
  }

  /** Switch the session mode. */
  setMode(sessionId: SessionId, modeId: string): Promise<RequestAck> {
    return this.send(sessionId, { type: 'set-mode', modeId });
  }

  /** Switch the approval policy (the permission axis, orthogonal to setMode). Rejects if the
   * adapter doesn't advertise policies. */
  setApprovalPolicy(sessionId: SessionId, policyId: string): Promise<RequestAck> {
    return this.send(sessionId, { type: 'set-approval-policy', policyId });
  }

  /** Fire-and-forget: announce this client now observes the session, so the daemon re-broadcasts
   * the buffered per-session state a late attacher missed (the approval-policy advertisement). */
  attachSession(sessionId: SessionId): void {
    this.transport.send(createWireMessage({ kind: 'session.attach', sessionId }));
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

  /** Answer a pending question-request. */
  respondQuestion(
    sessionId: SessionId,
    requestId: string,
    outcome: QuestionOutcome,
  ): Promise<RequestAck> {
    return this.send(sessionId, { type: 'question-response', requestId, outcome });
  }

  stopSession(sessionId: SessionId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'session.stop',
      clientReqId,
      sessionId,
    }));
  }

  /** Stop the session if live and remove its persisted record; provider-local history stays re-importable. */
  deleteSession(sessionId: SessionId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'session.delete',
      clientReqId,
      sessionId,
    }));
  }

  /** Read a file contained to a workspace directory (directory-backed, like git.*). */
  readFile(cwd: string, path: string): Promise<WorkspaceFile> {
    return this.sendCorrelated('fileRead', (clientReqId) => ({
      kind: 'file.read',
      clientReqId,
      cwd,
      path,
    }));
  }

  /** Every workspace file as a cwd-relative path. Like file.suggest, `cwd` must be a
   * registered workspace root (session start/resume registers it); unknown roots are rejected. */
  listFiles(cwd: string): Promise<string[]> {
    return this.sendCorrelated('fileList', (clientReqId) => ({
      kind: 'file.list',
      clientReqId,
      cwd,
    }));
  }

  /** Search workspace files by substring query. Unlike file.read/git.*, `cwd` must be a
   * registered workspace root (session start/resume registers it); unknown roots are rejected. */
  suggestFiles(cwd: string, query: string, limit?: number): Promise<FileSuggestion[]> {
    return this.sendCorrelated('fileSuggest', (clientReqId) => ({
      kind: 'file.suggest',
      clientReqId,
      cwd,
      query,
      limit,
    }));
  }

  /** The workspace's declared scripts with live lifecycle/health (directory-backed). */
  listScripts(cwd: string): Promise<WorkspaceScript[]> {
    return this.sendCorrelated('scriptList', (clientReqId) => ({
      kind: 'script.list',
      clientReqId,
      cwd,
    }));
  }

  /** Start a declared script; state changes stream via the client's `subscribeScriptStatus`. */
  startScript(cwd: string, scriptName: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'script.start',
      clientReqId,
      cwd,
      scriptName,
    }));
  }

  stopScript(cwd: string, scriptName: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'script.stop',
      clientReqId,
      cwd,
      scriptName,
    }));
  }

  /** Host inline artifact content on the daemon's ephemeral per-artifact origin. */
  hostArtifact(content: string, mimeType: string): Promise<HostedArtifact> {
    return this.sendCorrelated('artifactHost', (clientReqId) => ({
      kind: 'artifact.host',
      clientReqId,
      content,
      mimeType,
    }));
  }

  /** Read the daemon-owned provider config (data plane). */
  getProviderConfig(): Promise<ProvidersConfig> {
    return this.sendCorrelated('configGet', (clientReqId) => ({
      kind: 'config.get',
      clientReqId,
    }));
  }

  /** Read the daemon-owned global account pool (data plane). */
  getAccounts(): Promise<Accounts> {
    return this.sendCorrelated('accountsGet', (clientReqId) => ({
      kind: 'config.get',
      clientReqId,
    }));
  }

  /** Which agent CLIs the host can actually spawn (probed once at daemon boot). */
  listAgentRuntimes(): Promise<AgentRuntimes> {
    return this.sendCorrelated('agentRuntimeList', (clientReqId) => ({
      kind: 'agent-runtime.list',
      clientReqId,
    }));
  }

  /** Managed-asset store status: wanted versions and what is installed (CODE-111). */
  listAssets(): Promise<ManagedAssetStatus[]> {
    return this.sendCorrelated('assetList', (clientReqId) => ({
      kind: 'asset.list',
      clientReqId,
    }));
  }

  /**
   * Install the wanted version of a managed asset. Resolves when the install settles — minutes
   * for a real download (no pending timeout exists; a disconnect rejects). Progress meanwhile
   * streams via the `asset.progress` broadcast.
   */
  ensureAsset(id: ManagedAssetId): Promise<ManagedAssetStatus> {
    return this.sendCorrelated('assetEnsure', (clientReqId) => ({
      kind: 'asset.ensure',
      clientReqId,
      id,
    }));
  }

  /** Persist the daemon-owned provider config (data plane). Preserves the account pool. */
  setProviderConfig(providers: ProvidersConfig): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'config.set',
      clientReqId,
      providers,
    }));
  }

  /** Persist the daemon-owned global account pool (data plane). Preserves the provider config. */
  setAccounts(accounts: Accounts): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'config.set',
      clientReqId,
      accounts,
    }));
  }

  /** Local git facts for a directory (directory-backed: keyed by cwd, not by session). */
  getGitStatus(cwd: string): Promise<GitStatus> {
    return this.sendCorrelated('gitStatus', (clientReqId) => ({
      kind: 'git.status.get',
      clientReqId,
      cwd,
    }));
  }

  /** Hosting-provider PR state for a directory's current branch. */
  getGitPullRequestStatus(cwd: string): Promise<GitPullRequestStatus> {
    return this.sendCorrelated('gitPrStatus', (clientReqId) => ({
      kind: 'git.pr_status.get',
      clientReqId,
      cwd,
    }));
  }

  /** A unified-diff patch for a directory (directory-backed: keyed by cwd, not by session). */
  getGitDiff(cwd: string, mode: GitDiffMode): Promise<GitDiff> {
    return this.sendCorrelated('gitDiff', (clientReqId) => ({
      kind: 'git.diff.get',
      clientReqId,
      cwd,
      mode,
    }));
  }

  /** Every registered workspace (directory), most recently used first. */
  listWorkspaces(): Promise<WorkspaceRecord[]> {
    return this.sendCorrelated('workspaceList', (clientReqId) => ({
      kind: 'workspace.list',
      clientReqId,
    }));
  }

  /** Register a directory as a workspace; idempotent for an already-registered directory. */
  registerWorkspace(cwd: string, name?: string, kind?: WorkspaceKind): Promise<WorkspaceRecord> {
    return this.sendCorrelated('workspaceRegister', (clientReqId) => ({
      kind: 'workspace.register',
      clientReqId,
      cwd,
      name,
      workspaceKind: kind,
    }));
  }

  updateWorkspace(workspaceId: WorkspaceId, name: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'workspace.update',
      clientReqId,
      workspaceId,
      name,
    }));
  }

  /** Drop a workspace from the registry; never touches the directory on disk. */
  archiveWorkspace(workspaceId: WorkspaceId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'workspace.archive',
      clientReqId,
      workspaceId,
    }));
  }

  /** Create a recurring schedule; state changes then stream via `subscribeScheduleEvents`. */
  createSchedule(spec: ScheduleSpec): Promise<Schedule> {
    return this.sendCorrelated('scheduleCreate', (clientReqId) => ({
      kind: 'schedule.create',
      clientReqId,
      spec,
    }));
  }

  /** Edit a schedule's mutable fields (everything but its target). */
  updateSchedule(scheduleId: ScheduleId, patch: ScheduleUpdate): Promise<Schedule> {
    return this.sendCorrelated('scheduleUpdate', (clientReqId) => ({
      kind: 'schedule.update',
      clientReqId,
      scheduleId,
      patch,
    }));
  }

  deleteSchedule(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'schedule.delete',
      clientReqId,
      scheduleId,
    }));
  }

  pauseSchedule(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'schedule.pause',
      clientReqId,
      scheduleId,
    }));
  }

  resumeSchedule(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'schedule.resume',
      clientReqId,
      scheduleId,
    }));
  }

  /** Fire one manual run now without touching the cadence. */
  runScheduleOnce(scheduleId: ScheduleId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'schedule.run-once',
      clientReqId,
      scheduleId,
    }));
  }

  listSchedules(): Promise<Schedule[]> {
    return this.sendCorrelated('scheduleList', (clientReqId) => ({
      kind: 'schedule.list',
      clientReqId,
    }));
  }

  /** A schedule's run history, newest first. */
  listScheduleRuns(scheduleId: ScheduleId, limit?: number): Promise<ScheduleRun[]> {
    return this.sendCorrelated('scheduleRuns', (clientReqId) => ({
      kind: 'schedule.runs.list',
      clientReqId,
      scheduleId,
      limit,
    }));
  }

  /** Start an iterate-until-verified loop; progress then streams via `subscribeLoopEvents`. */
  startLoop(spec: LoopSpec): Promise<LoopRecord> {
    return this.sendCorrelated('loopStart', (clientReqId) => ({
      kind: 'loop.start',
      clientReqId,
      spec,
    }));
  }

  /** Signal a running loop to stop; it settles to `stopped`. */
  stopLoop(loopId: LoopId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'loop.stop',
      clientReqId,
      loopId,
    }));
  }

  /** Delete a settled loop and its iteration history; rejects while it is still running. */
  deleteLoop(loopId: LoopId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'loop.delete',
      clientReqId,
      loopId,
    }));
  }

  listLoops(): Promise<LoopRecord[]> {
    return this.sendCorrelated('loopList', (clientReqId) => ({
      kind: 'loop.list',
      clientReqId,
    }));
  }

  /** A loop's full detail: record + iterations + the live log tail (ring-buffered snapshot). */
  inspectLoop(loopId: LoopId): Promise<LoopInspection> {
    return this.sendCorrelated('loopInspect', (clientReqId) => ({
      kind: 'loop.inspect',
      clientReqId,
      loopId,
    }));
  }

  private sendCorrelated<K extends keyof PendingValueMap>(
    kind: K,
    makePayload: (clientReqId: string) => WirePayload,
  ): Promise<PendingValueMap[K]> {
    return sendCorrelated(this.transport, this.pending, kind, makePayload);
  }
}
