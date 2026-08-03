import type {
  Account,
  AccountEndpoint,
  AccountModel,
  AccountSecret,
  Accounts,
  AgentHistoryBranchCursor,
  AgentHistoryId,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
  AgentRuntimes,
  AgentStartCatalog,
  ContentBlock,
  CustomMcpServerPatchOp,
  CustomMcpServerPublic,
  EffortLevel,
  FileSuggestion,
  GitBranchList,
  GitBranchSwitchCheck,
  GitDiff,
  GitDiffMode,
  GitPullRequestStatus,
  GitStatus,
  HostedArtifact,
  HostedFile,
  HostedSessionResource,
  LoopId,
  LoopInspection,
  LoopRecord,
  LoopSpec,
  ManagedAssetId,
  ManagedAssetStatus,
  MessageId,
  PermissionOutcome,
  PluginProvider,
  PluginScope,
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
  SessionResource,
  SessionResourceId,
  SessionSubscriptionMode,
  SimulatorAxNode,
  SimulatorButton,
  SimulatorConsentDecision,
  SimulatorConsentState,
  SimulatorDevice,
  SimulatorImageFormat,
  SimulatorOrientation,
  SimulatorStatus,
  SimulatorStreamCodec,
  SimulatorTouchPhase,
  StandaloneSkill,
  StandaloneSkillScope,
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
import type {
  PendingRegistry,
  PendingValueMap,
  PluginList,
  PluginMutation,
  RequestAck,
  SessionStartResult,
} from './pending-registry';
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

  startSession(opts: StartOptions): Promise<SessionStartResult> {
    return this.sendCorrelated('start', (clientReqId) => ({
      kind: 'session.start',
      clientReqId,
      opts,
    }));
  }

  getAgentCatalog(agentKind: AgentKind, cwd?: string): Promise<AgentStartCatalog> {
    return this.sendCorrelated('agentCatalog', (clientReqId) => ({
      kind: 'agent.catalog',
      clientReqId,
      agentKind,
      cwd,
    }));
  }

  listSessions(): Promise<SessionInfo[]> {
    return this.sendCorrelated('list', (clientReqId) => ({ kind: 'session.list', clientReqId }));
  }

  /** Resume a persisted (cold) session by its Link Code id; resolves with the same id. */
  resumeSession(sessionId: SessionId): Promise<SessionStartResult> {
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
  ): Promise<SessionStartResult> {
    return this.sendCorrelated('start', (clientReqId) => ({
      kind: 'history.resume',
      clientReqId,
      agentKind,
      historyId,
      startOpts: { ...startOpts, kind: agentKind },
    }));
  }

  branchHistory(
    sourceSessionId: SessionId,
    sourceMessageId: MessageId,
    branchCursor: AgentHistoryBranchCursor,
    content: ContentBlock[],
  ): Promise<SessionStartResult> {
    return this.sendCorrelated('start', (clientReqId) => ({
      kind: 'history.branch',
      clientReqId,
      sourceSessionId,
      sourceMessageId,
      branchCursor,
      content,
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
   * the buffered per-session state a late attacher missed (the approval-policy advertisement).
   * Also what `attached` delivery scopes to — see {@link setSubscriptionMode}. */
  attachSession(sessionId: SessionId): void {
    this.transport.send(createWireMessage({ kind: 'session.attach', sessionId }));
  }

  /** Fire-and-forget: stop observing the session. Under `attached` scope its `agent.event`s stop
   * arriving, so a client that may reopen the session needs a seed read to catch up. */
  detachSession(sessionId: SessionId): void {
    this.transport.send(createWireMessage({ kind: 'session.detach', sessionId }));
  }

  /** Scope this connection's `agent.event` delivery. Answered by the Hub, not the Engine, and
   * scoped to this connection only. `attached` is for clients paying per byte — every session the
   * caller still wants must already be, or later be, announced via {@link attachSession}. */
  setSubscriptionMode(mode: SessionSubscriptionMode): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'subscription.set',
      clientReqId,
      mode,
    }));
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

  listResources(sessionId: SessionId): Promise<SessionResource[]> {
    return this.sendCorrelated('resourceList', (clientReqId) => ({
      kind: 'resource.list',
      clientReqId,
      sessionId,
    }));
  }

  uploadSource(
    sessionId: SessionId,
    name: string,
    data: string,
    mimeType?: string,
  ): Promise<SessionResource> {
    return this.sendCorrelated('resourceUpload', (clientReqId) => ({
      kind: 'resource.source.upload',
      clientReqId,
      sessionId,
      name,
      mimeType,
      data,
    }));
  }

  removeResource(resourceId: SessionResourceId): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'resource.remove',
      clientReqId,
      resourceId,
    }));
  }

  hostResource(resourceId: SessionResourceId): Promise<HostedSessionResource> {
    return this.sendCorrelated('resourceHost', (clientReqId) => ({
      kind: 'resource.host',
      clientReqId,
      resourceId,
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

  /** Host a workspace file on the daemon's per-file origin, streamed with Range (CODE-316). */
  hostFile(cwd: string, path: string): Promise<HostedFile> {
    return this.sendCorrelated('fileHost', (clientReqId) => ({
      kind: 'file.host',
      clientReqId,
      cwd,
      path,
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

  /** Read the daemon-owned custom MCP servers (masked projection — never carries a secret). */
  getCustomMcpServers(): Promise<CustomMcpServerPublic[]> {
    return this.sendCorrelated('customMcpGet', (clientReqId) => ({
      kind: 'config.get',
      clientReqId,
    }));
  }

  /** Apply custom-MCP patch ops (add / per-key secret update / remove). Preserves other config. */
  setCustomMcpServers(patches: CustomMcpServerPatchOp[]): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'config.set',
      clientReqId,
      customMcpServers: patches,
    }));
  }

  /** Discover provider plugins and standalone skills (a real CLI shell-out on the daemon). */
  listPlugins(cwd?: string): Promise<PluginList> {
    return this.sendCorrelated('pluginList', (clientReqId) => ({
      kind: 'plugin.list.get',
      clientReqId,
      cwd,
    }));
  }

  /** Toggle a plugin through its provider; resolves with the re-listed, updated plugin. */
  setPluginEnabled(params: {
    provider: PluginProvider;
    id: string;
    enabled: boolean;
    scope?: PluginScope;
    cwd?: string;
  }): Promise<PluginMutation> {
    return this.sendCorrelated('pluginMutation', (clientReqId) => ({
      kind: 'plugin.set-enabled',
      clientReqId,
      ...params,
    }));
  }

  /** Install a catalog entry. `pendingAuthApps` names provider apps the install left unauthorized —
   * codex reports them for most of its catalog and LinkCode cannot complete those flows. */
  installPlugin(params: {
    provider: PluginProvider;
    id: string;
    cwd?: string;
  }): Promise<PluginMutation> {
    return this.sendCorrelated('pluginMutation', (clientReqId) => ({
      kind: 'plugin.install',
      clientReqId,
      ...params,
    }));
  }

  /** Drop an installed plugin's local state; the marketplace entry itself survives. */
  uninstallPlugin(params: {
    provider: PluginProvider;
    id: string;
    cwd?: string;
  }): Promise<PluginMutation> {
    return this.sendCorrelated('pluginMutation', (clientReqId) => ({
      kind: 'plugin.uninstall',
      clientReqId,
      ...params,
    }));
  }

  /** Toggle one skill through its provider; resolves with the re-read skill. */
  setSkillEnabled(params: {
    provider: PluginProvider;
    skillId: string;
    path: string;
    scope?: StandaloneSkillScope;
    enabled: boolean;
    cwd?: string;
  }): Promise<StandaloneSkill> {
    return this.sendCorrelated('skillSetEnabled', (clientReqId) => ({
      kind: 'skill.set-enabled',
      clientReqId,
      ...params,
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

  createAndBindAccount(agent: AgentKind, account: Account): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'config.account.create-and-bind',
      clientReqId,
      agent,
      account,
    }));
  }

  /** Ask the daemon what an endpoint serves, using a not-yet-saved secret: the account forms offer
   * the answer as the model picker. The daemon must do it — the renderer's CSP blocks the fetch. */
  probeAccountModels(endpoint: AccountEndpoint, secret: AccountSecret): Promise<AccountModel[]> {
    return this.sendCorrelated('accountModels', (clientReqId) => ({
      kind: 'config.probe-models',
      clientReqId,
      endpoint,
      secret,
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

  /** Local branches for a directory, ordered current-first then by descending commit date. */
  listGitBranches(cwd: string): Promise<GitBranchList> {
    return this.sendCorrelated('gitBranchList', (clientReqId) => ({
      kind: 'git.branch.list',
      clientReqId,
      cwd,
    }));
  }

  checkGitBranchSwitch(cwd: string, branch: string): Promise<GitBranchSwitchCheck> {
    return this.sendCorrelated('gitBranchSwitchCheck', (clientReqId) => ({
      kind: 'git.branch.switch.check',
      clientReqId,
      cwd,
      branch,
    }));
  }

  createGitBranch(cwd: string, branch: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'git.branch.create',
      clientReqId,
      cwd,
      branch,
    }));
  }

  commitGitChanges(cwd: string, message: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'git.commit',
      clientReqId,
      cwd,
      message,
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

  simulatorStatus(): Promise<SimulatorStatus> {
    return this.sendCorrelated('simulatorStatus', (clientReqId) => ({
      kind: 'simulator.status',
      clientReqId,
    }));
  }

  simulatorList(): Promise<SimulatorDevice[]> {
    return this.sendCorrelated('simulatorList', (clientReqId) => ({
      kind: 'simulator.list',
      clientReqId,
    }));
  }

  simulatorBoot(sessionId: SessionId, udid: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.boot',
      clientReqId,
      sessionId,
      udid,
    }));
  }

  simulatorShutdown(sessionId: SessionId, udid: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.shutdown',
      clientReqId,
      sessionId,
      udid,
    }));
  }

  simulatorInstall(sessionId: SessionId, udid: string, appPath: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.install',
      clientReqId,
      sessionId,
      udid,
      appPath,
    }));
  }

  /** Resolves with the launched pid (`null` when the host could not report one). */
  simulatorLaunch(sessionId: SessionId, udid: string, bundleId: string): Promise<number | null> {
    return this.sendCorrelated('simulatorLaunch', (clientReqId) => ({
      kind: 'simulator.launch',
      clientReqId,
      sessionId,
      udid,
      bundleId,
    }));
  }

  simulatorTerminate(sessionId: SessionId, udid: string, bundleId: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.terminate',
      clientReqId,
      sessionId,
      udid,
      bundleId,
    }));
  }

  simulatorOpenUrl(sessionId: SessionId, udid: string, url: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.open-url',
      clientReqId,
      sessionId,
      udid,
      url,
    }));
  }

  /** Resolves with base64-encoded image bytes in the requested format (default jpeg). */
  simulatorScreenshot(
    sessionId: SessionId,
    udid: string,
    format?: SimulatorImageFormat,
  ): Promise<{ format: SimulatorImageFormat; data: string }> {
    return this.sendCorrelated('simulatorScreenshot', (clientReqId) => ({
      kind: 'simulator.screenshot',
      clientReqId,
      sessionId,
      udid,
      format,
    }));
  }

  /** Shake the device — the gesture apps use for "undo typing" and, in React Native, the dev menu. */
  simulatorShake(sessionId: SessionId, udid: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.shake',
      clientReqId,
      sessionId,
      udid,
    }));
  }

  /** Start the iOS runtime download. Resolves once it is running, not once it finishes — poll
   * {@link simulatorStatus} until the blocker clears to follow progress. */
  simulatorInstallRuntime(): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.install-runtime',
      clientReqId,
    }));
  }

  /** Resolves with the frontmost app's accessibility tree. Node centres are normalized 0..1, the
   * same scale {@link simulatorTap} takes, so a caller can act on a node it found by label. */
  simulatorDescribeUi(
    sessionId: SessionId,
    udid: string,
    limits?: { maxDepth?: number; maxNodes?: number },
  ): Promise<SimulatorAxNode> {
    return this.sendCorrelated('simulatorDescribeUi', (clientReqId) => ({
      kind: 'simulator.describe-ui',
      clientReqId,
      sessionId,
      udid,
      maxDepth: limits?.maxDepth,
      maxNodes: limits?.maxNodes,
    }));
  }

  /** Resolves with the device's screen-outline mask as base64 PNG (no session claim). */
  simulatorScreenMask(udid: string): Promise<string> {
    return this.sendCorrelated('simulatorScreenMask', (clientReqId) => ({
      kind: 'simulator.screen-mask',
      clientReqId,
      udid,
    }));
  }

  /** Current per-device agent consent plus the global agent-tools switch (CODE-420). */
  simulatorConsentGet(): Promise<SimulatorConsentState> {
    return this.sendCorrelated('simulatorConsentGet', (clientReqId) => ({
      kind: 'simulator.consent.get',
      clientReqId,
    }));
  }

  /** Record a decision for a device; `undefined` clears it, so the next agent call asks again. */
  simulatorConsentSet(udid: string, decision?: SimulatorConsentDecision): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.consent.set',
      clientReqId,
      udid,
      decision,
    }));
  }

  simulatorConsentSetAgentTools(enabled: boolean): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.consent.set-agent-tools',
      clientReqId,
      enabled,
    }));
  }

  simulatorTap(sessionId: SessionId, udid: string, x: number, y: number): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.tap',
      clientReqId,
      sessionId,
      udid,
      x,
      y,
    }));
  }

  simulatorKey(
    sessionId: SessionId,
    udid: string,
    usage: number,
    modifiers: number[],
  ): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.key',
      clientReqId,
      sessionId,
      udid,
      usage,
      modifiers,
    }));
  }

  simulatorTouch(
    sessionId: SessionId,
    udid: string,
    phase: SimulatorTouchPhase,
    x: number,
    y: number,
  ): Promise<RequestAck> {
    // `move` phases fire at up to 60 Hz; a per-move round-trip would stall the gesture, so they go
    // out unacked (the engine skips the reply). `down`/`up` stay correlated so a claim conflict or
    // the gesture's completion is still observable.
    if (phase === 'move') {
      this.transport.send(
        createWireMessage({
          kind: 'simulator.touch',
          clientReqId: this.pending.nextClientReqId(),
          sessionId,
          udid,
          phase,
          x,
          y,
        }),
      );
      return Promise.resolve({ ok: true });
    }
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.touch',
      clientReqId,
      sessionId,
      udid,
      phase,
      x,
      y,
    }));
  }

  simulatorPinch(
    sessionId: SessionId,
    udid: string,
    phase: SimulatorTouchPhase,
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): Promise<RequestAck> {
    if (phase === 'move') {
      this.transport.send(
        createWireMessage({
          kind: 'simulator.pinch',
          clientReqId: this.pending.nextClientReqId(),
          sessionId,
          udid,
          phase,
          x0: a.x,
          y0: a.y,
          x1: b.x,
          y1: b.y,
        }),
      );
      return Promise.resolve({ ok: true });
    }
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.pinch',
      clientReqId,
      sessionId,
      udid,
      phase,
      x0: a.x,
      y0: a.y,
      x1: b.x,
      y1: b.y,
    }));
  }

  simulatorPaste(sessionId: SessionId, udid: string, text: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.paste',
      clientReqId,
      sessionId,
      udid,
      text,
    }));
  }

  simulatorSwipe(
    sessionId: SessionId,
    udid: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.swipe',
      clientReqId,
      sessionId,
      udid,
      x0: from.x,
      y0: from.y,
      x1: to.x,
      y1: to.y,
      durationMs,
    }));
  }

  simulatorButton(
    sessionId: SessionId,
    udid: string,
    button: SimulatorButton,
  ): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.button',
      clientReqId,
      sessionId,
      udid,
      button,
    }));
  }

  simulatorRotate(
    sessionId: SessionId,
    udid: string,
    orientation: SimulatorOrientation,
  ): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.rotate',
      clientReqId,
      sessionId,
      udid,
      orientation,
    }));
  }

  /** Resolves with the accepted `{ fps, scale, codec }`; frames then arrive as `simulator.stream.frame`. */
  simulatorStreamStart(
    sessionId: SessionId,
    udid: string,
    options?: { fps?: number; quality?: number; scale?: number; codec?: SimulatorStreamCodec },
  ): Promise<{ fps: number; scale: number; codec: SimulatorStreamCodec }> {
    return this.sendCorrelated('simulatorStreamStart', (clientReqId) => ({
      kind: 'simulator.stream.start',
      clientReqId,
      sessionId,
      udid,
      fps: options?.fps,
      quality: options?.quality,
      scale: options?.scale,
      codec: options?.codec,
    }));
  }

  simulatorStreamStop(sessionId: SessionId, udid: string): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'simulator.stream.stop',
      clientReqId,
      sessionId,
      udid,
    }));
  }

  private sendCorrelated<K extends keyof PendingValueMap>(
    kind: K,
    makePayload: (clientReqId: string) => WirePayload,
  ): Promise<PendingValueMap[K]> {
    return sendCorrelated(this.transport, this.pending, kind, makePayload);
  }
}
