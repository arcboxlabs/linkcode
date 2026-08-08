import type {
  AssetProgressEvent,
  AssetSettledEvent,
  HistoryListClientOptions,
  HistoryReadClientOptions,
  PluginList,
  PluginMutation,
  SessionStartResult,
} from '@linkcode/client-core';
import { LinkCodeClient } from '@linkcode/client-core';
import type {
  Account,
  AccountModel,
  AccountSecret,
  Accounts,
  AgentHistoryBranchCursor,
  AgentHistoryId,
  AgentHistoryListResult,
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
  SessionNotification,
  SessionRecord,
  SessionResource,
  SessionResourceId,
  StandaloneSkill,
  StandaloneSkillScope,
  StartOptions,
  WorkspaceFile,
  WorkspaceId,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceScript,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';

export type RequestResult<T = unknown> = Promise<{
  data: T;
  request?: Request;
  response?: Response;
}>;

export type Options<TData extends object = object> = TData & {
  client?: LinkCodeSdkClient;
  meta?: Record<string, unknown>;
};

export interface LinkCodeSdkClientOptions {
  transport: Transport;
}

export class LinkCodeSdkClient {
  readonly raw: LinkCodeClient;

  constructor(options: LinkCodeSdkClientOptions) {
    this.raw = new LinkCodeClient(options.transport);
  }

  buildUrl(): string {
    return 'linkcode://transport';
  }

  getConfig(): Record<string, never> {
    return {};
  }

  setConfig(): void {
    // The transport-backed SDK is configured at construction time.
  }

  request(): Promise<never> {
    return Promise.reject(new Error('LinkCodeSdkClient does not expose raw HTTP requests'));
  }

  connect(): Promise<void> {
    return this.raw.connect();
  }

  /** Observe an unexpected close after the client has completed its LinkCode handshake. */
  onClose(cb: (error: Error) => void): () => void {
    return this.raw.onClose(cb);
  }

  dispose(): void {
    this.raw.dispose();
  }

  listSessions(): RequestResult<SessionInfo[]> {
    return toResult(this.raw.listSessions());
  }

  startSession(opts: StartOptions): RequestResult<SessionId> {
    return toResult(this.raw.startSession(opts));
  }

  startSessionWithWarnings(opts: StartOptions): RequestResult<SessionStartResult> {
    return toResult(this.raw.startSessionWithWarnings(opts));
  }

  getAgentCatalog(agentKind: AgentKind, cwd?: string): RequestResult<AgentStartCatalog> {
    return toResult(this.raw.getAgentCatalog(agentKind, cwd));
  }

  stopSession(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.stopSession(sessionId));
  }

  /** Stop the session if live and remove its persisted record; provider-local history stays re-importable. */
  deleteSession(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.deleteSession(sessionId));
  }

  listResources(sessionId: SessionId): RequestResult<SessionResource[]> {
    return toResult(this.raw.listResources(sessionId));
  }
  uploadSource(
    sessionId: SessionId,
    name: string,
    data: string,
    mimeType?: string,
  ): RequestResult<SessionResource> {
    return toResult(this.raw.uploadSource(sessionId, name, data, mimeType));
  }
  removeResource(resourceId: SessionResourceId): RequestResult<{ ok: true }> {
    return toResult(this.raw.removeResource(resourceId));
  }
  hostResource(resourceId: SessionResourceId): RequestResult<HostedSessionResource> {
    return toResult(this.raw.hostResource(resourceId));
  }
  subscribeResources(cb: Parameters<LinkCodeClient['subscribeResources']>[0]): () => void {
    return this.raw.subscribeResources(cb);
  }

  /** Resume a persisted (cold) session by its Link Code id; resolves with the same id. */
  resumeSession(sessionId: SessionId): RequestResult<SessionId> {
    return toResult(this.raw.resumeSession(sessionId));
  }

  resumeSessionWithWarnings(sessionId: SessionId): RequestResult<SessionStartResult> {
    return toResult(this.raw.resumeSessionWithWarnings(sessionId));
  }

  /** Import a provider-local history session as a cold record (listed, not started). */
  importSession(agentKind: AgentKind, historyId: AgentHistoryId): RequestResult<SessionRecord> {
    return toResult(this.raw.importSession(agentKind, historyId));
  }

  listHistory(
    agentKind: AgentKind,
    opts?: HistoryListClientOptions,
  ): RequestResult<AgentHistoryListResult> {
    return toResult(this.raw.listHistory(agentKind, opts));
  }

  readHistory(
    agentKind: AgentKind,
    opts: HistoryReadClientOptions,
  ): RequestResult<AgentHistoryReadResult> {
    return toResult(this.raw.readHistory(agentKind, opts));
  }

  resumeHistory(
    agentKind: AgentKind,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): RequestResult<SessionId> {
    return toResult(this.raw.resumeHistory(agentKind, historyId, startOpts));
  }

  resumeHistoryWithWarnings(
    agentKind: AgentKind,
    historyId: AgentHistoryId,
    startOpts: StartOptions,
  ): RequestResult<SessionStartResult> {
    return toResult(this.raw.resumeHistoryWithWarnings(agentKind, historyId, startOpts));
  }

  rewritePrompt(
    sourceSessionId: SessionId,
    sourceMessageId: MessageId,
    branchCursor: AgentHistoryBranchCursor,
    content: ContentBlock[],
  ): RequestResult<SessionId> {
    return toResult(
      this.raw.rewritePrompt(sourceSessionId, sourceMessageId, branchCursor, content),
    );
  }

  sendInput(sessionId: SessionId, input: AgentInput): RequestResult<{ ok: true }> {
    return toResult(this.raw.send(sessionId, input));
  }

  promptText(sessionId: SessionId, text: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.promptText(sessionId, text));
  }

  invokeCommand(sessionId: SessionId, name: string, args?: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.invokeCommand(sessionId, name, args));
  }

  runShellCommand(sessionId: SessionId, command: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.runShellCommand(sessionId, command));
  }

  cancel(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.cancel(sessionId));
  }

  setModel(sessionId: SessionId, model: string, accountId?: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.setModel(sessionId, model, accountId));
  }

  setEffort(sessionId: SessionId, effort: EffortLevel): RequestResult<{ ok: true }> {
    return toResult(this.raw.setEffort(sessionId, effort));
  }

  respondPermission(
    sessionId: SessionId,
    requestId: string,
    outcome: PermissionOutcome,
  ): RequestResult<{ ok: true }> {
    return toResult(this.raw.respondPermission(sessionId, requestId, outcome));
  }

  respondQuestion(
    sessionId: SessionId,
    requestId: string,
    outcome: QuestionOutcome,
  ): RequestResult<{ ok: true }> {
    return toResult(this.raw.respondQuestion(sessionId, requestId, outcome));
  }

  /** Read the daemon-owned provider config (data plane). */
  getProviderConfig(): RequestResult<ProvidersConfig> {
    return toResult(this.raw.getProviderConfig());
  }

  /** Persist the daemon-owned provider config (data plane). */
  setProviderConfig(providers: ProvidersConfig): RequestResult<{ ok: true }> {
    return toResult(this.raw.setProviderConfig(providers));
  }

  createAndBindAccount(agent: AgentKind, account: Account): RequestResult<{ ok: true }> {
    return toResult(this.raw.createAndBindAccount(agent, account));
  }

  /** Read the daemon-owned global account pool (data plane). */
  getAccounts(): RequestResult<Accounts> {
    return toResult(this.raw.getAccounts());
  }

  /** Persist the daemon-owned global account pool (data plane). */
  setAccounts(accounts: Accounts): RequestResult<{ ok: true }> {
    return toResult(this.raw.setAccounts(accounts));
  }

  /** Enumerate the models a service serves, with an unsaved secret or a saved account's own. */
  probeAccountModels(
    service: string,
    credential: { type: 'inline'; secret: AccountSecret } | { type: 'account'; accountId: string },
  ): RequestResult<AccountModel[]> {
    return toResult(this.raw.probeAccountModels(service, credential));
  }

  /** Masked custom MCP servers (data plane) — env/header keys only, never a secret value. */
  getCustomMcpServers(): RequestResult<CustomMcpServerPublic[]> {
    return toResult(this.raw.getCustomMcpServers());
  }

  /** Apply custom-MCP patch ops (add / per-key secret update / remove). */
  setCustomMcpServers(patches: CustomMcpServerPatchOp[]): RequestResult<{ ok: true }> {
    return toResult(this.raw.setCustomMcpServers(patches));
  }

  /** Discover provider plugins + standalone skills (slow: a CLI shell-out on the daemon). */
  listPlugins(cwd?: string): RequestResult<PluginList> {
    return toResult(this.raw.listPlugins(cwd));
  }

  /** Toggle a plugin; resolves with the re-listed plugin for single-entry cache patching. */
  setPluginEnabled(params: {
    provider: PluginProvider;
    id: string;
    enabled: boolean;
    scope?: PluginScope;
    cwd?: string;
  }): RequestResult<PluginMutation> {
    return toResult(this.raw.setPluginEnabled(params));
  }

  /** Install a catalog entry the host does not have yet. */
  installPlugin(params: {
    provider: PluginProvider;
    id: string;
    cwd?: string;
  }): RequestResult<PluginMutation> {
    return toResult(this.raw.installPlugin(params));
  }

  /** Uninstall a plugin; the marketplace entry survives with no installations. */
  uninstallPlugin(params: {
    provider: PluginProvider;
    id: string;
    cwd?: string;
  }): RequestResult<PluginMutation> {
    return toResult(this.raw.uninstallPlugin(params));
  }

  /** Toggle one skill through its provider; resolves with the re-read skill. */
  setSkillEnabled(params: {
    provider: PluginProvider;
    skillId: string;
    path: string;
    scope?: StandaloneSkillScope;
    enabled: boolean;
    cwd?: string;
  }): RequestResult<StandaloneSkill> {
    return toResult(this.raw.setSkillEnabled(params));
  }

  /** Which agent CLIs the host can actually spawn (probed once at daemon boot). */
  listAgentRuntimes(): RequestResult<AgentRuntimes> {
    return toResult(this.raw.listAgentRuntimes());
  }

  /** Managed-asset store status: wanted versions and what is installed (CODE-111). */
  listAssets(): RequestResult<ManagedAssetStatus[]> {
    return toResult(this.raw.listAssets());
  }

  /** Install a managed asset; resolves when the install settles (progress via subscribeAssetProgress). */
  ensureAsset(id: ManagedAssetId): RequestResult<ManagedAssetStatus> {
    return toResult(this.raw.ensureAsset(id));
  }

  /** Broadcast download progress for every in-flight managed install (callers filter by id). */
  subscribeAssetProgress(cb: (event: AssetProgressEvent) => void): () => void {
    return this.raw.subscribeAssetProgress(cb);
  }

  /** Broadcast terminal state of managed installs, including boot-triggered background ones. */
  subscribeAssetSettled(cb: (event: AssetSettledEvent) => void): () => void {
    return this.raw.subscribeAssetSettled(cb);
  }

  /** Pushed whenever the daemon re-probes agent runtimes (a managed agent install landed). */
  subscribeAgentRuntimesChanged(cb: (runtimes: AgentRuntimes) => void): () => void {
    return this.raw.subscribeAgentRuntimesChanged(cb);
  }

  /** Local git facts for a directory (directory-backed: keyed by cwd, not by session). */
  getGitStatus(cwd: string): RequestResult<GitStatus> {
    return toResult(this.raw.getGitStatus(cwd));
  }

  /** Local branches for a directory, ordered current-first then by descending commit date. */
  listGitBranches(cwd: string): RequestResult<GitBranchList> {
    return toResult(this.raw.listGitBranches(cwd));
  }

  checkGitBranchSwitch(cwd: string, branch: string): RequestResult<GitBranchSwitchCheck> {
    return toResult(this.raw.checkGitBranchSwitch(cwd, branch));
  }

  createGitBranch(cwd: string, branch: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.createGitBranch(cwd, branch));
  }

  commitGitChanges(cwd: string, message: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.commitGitChanges(cwd, message));
  }

  /** Hosting-provider PR state for a directory's current branch. */
  getGitPullRequestStatus(cwd: string): RequestResult<GitPullRequestStatus> {
    return toResult(this.raw.getGitPullRequestStatus(cwd));
  }

  /** A unified-diff patch for a directory (directory-backed: keyed by cwd, not by session). */
  getGitDiff(cwd: string, mode: GitDiffMode): RequestResult<GitDiff> {
    return toResult(this.raw.getGitDiff(cwd, mode));
  }

  /** Read a file contained to a workspace directory (directory-backed, like git.*). */
  readFile(cwd: string, path: string): RequestResult<WorkspaceFile> {
    return toResult(this.raw.readFile(cwd, path));
  }

  /** Every workspace file as a cwd-relative path. Like file.suggest, `cwd` must be a
   * registered workspace root (session start/resume registers it); unknown roots are rejected. */
  listFiles(cwd: string): RequestResult<string[]> {
    return toResult(this.raw.listFiles(cwd));
  }

  /** Search workspace files by substring query. Unlike file.read/git.*, `cwd` must be a
   * registered workspace root (session start/resume registers it); unknown roots are rejected. */
  suggestFiles(cwd: string, query: string, limit?: number): RequestResult<FileSuggestion[]> {
    return toResult(this.raw.suggestFiles(cwd, query, limit));
  }

  /** The workspace's declared scripts with live lifecycle/health (directory-backed). */
  listScripts(cwd: string): RequestResult<WorkspaceScript[]> {
    return toResult(this.raw.listScripts(cwd));
  }

  startScript(cwd: string, scriptName: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.startScript(cwd, scriptName));
  }

  stopScript(cwd: string, scriptName: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.stopScript(cwd, scriptName));
  }

  /** Broadcast `script.status` updates for every workspace (callers filter by cwd). */
  subscribeScriptStatus(cb: (cwd: string, script: WorkspaceScript) => void): () => void {
    return this.raw.subscribeScriptStatus(cb);
  }

  /** Broadcast `session.notification` moments for every session, foreground or background. */
  subscribeSessionNotification(cb: (notification: SessionNotification) => void): () => void {
    return this.raw.subscribeSessionNotification(cb);
  }

  /** Host inline artifact content on the daemon's ephemeral per-artifact origin. */
  hostArtifact(content: string, mimeType: string): RequestResult<HostedArtifact> {
    return toResult(this.raw.hostArtifact(content, mimeType));
  }

  /** Host a workspace file on the daemon's per-file origin, streamed with Range (CODE-316). */
  hostFile(cwd: string, path: string): RequestResult<HostedFile> {
    return toResult(this.raw.hostFile(cwd, path));
  }

  /** Every registered workspace (directory), most recently used first. */
  listWorkspaces(): RequestResult<WorkspaceRecord[]> {
    return toResult(this.raw.listWorkspaces());
  }

  /** Register a directory as a workspace; idempotent for an already-registered directory. */
  registerWorkspace(
    cwd: string,
    name?: string,
    kind?: WorkspaceKind,
  ): RequestResult<WorkspaceRecord> {
    return toResult(this.raw.registerWorkspace(cwd, name, kind));
  }

  updateWorkspace(workspaceId: WorkspaceId, name: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.updateWorkspace(workspaceId, name));
  }

  /** Drop a workspace from the registry; never touches the directory on disk. */
  archiveWorkspace(workspaceId: WorkspaceId): RequestResult<{ ok: true }> {
    return toResult(this.raw.archiveWorkspace(workspaceId));
  }

  createSchedule(spec: ScheduleSpec): RequestResult<Schedule> {
    return toResult(this.raw.createSchedule(spec));
  }

  updateSchedule(scheduleId: ScheduleId, patch: ScheduleUpdate): RequestResult<Schedule> {
    return toResult(this.raw.updateSchedule(scheduleId, patch));
  }

  deleteSchedule(scheduleId: ScheduleId): RequestResult<{ ok: true }> {
    return toResult(this.raw.deleteSchedule(scheduleId));
  }

  pauseSchedule(scheduleId: ScheduleId): RequestResult<{ ok: true }> {
    return toResult(this.raw.pauseSchedule(scheduleId));
  }

  resumeSchedule(scheduleId: ScheduleId): RequestResult<{ ok: true }> {
    return toResult(this.raw.resumeSchedule(scheduleId));
  }

  runScheduleOnce(scheduleId: ScheduleId): RequestResult<{ ok: true }> {
    return toResult(this.raw.runScheduleOnce(scheduleId));
  }

  listSchedules(): RequestResult<Schedule[]> {
    return toResult(this.raw.listSchedules());
  }

  listScheduleRuns(scheduleId: ScheduleId, limit?: number): RequestResult<ScheduleRun[]> {
    return toResult(this.raw.listScheduleRuns(scheduleId, limit));
  }

  startLoop(spec: LoopSpec): RequestResult<LoopRecord> {
    return toResult(this.raw.startLoop(spec));
  }

  stopLoop(loopId: LoopId): RequestResult<{ ok: true }> {
    return toResult(this.raw.stopLoop(loopId));
  }

  deleteLoop(loopId: LoopId): RequestResult<{ ok: true }> {
    return toResult(this.raw.deleteLoop(loopId));
  }

  listLoops(): RequestResult<LoopRecord[]> {
    return toResult(this.raw.listLoops());
  }

  inspectLoop(loopId: LoopId): RequestResult<LoopInspection> {
    return toResult(this.raw.inspectLoop(loopId));
  }
}

let defaultClient: LinkCodeSdkClient | null = null;

export function createClient(options: LinkCodeSdkClientOptions): LinkCodeSdkClient {
  return new LinkCodeSdkClient(options);
}

export function setDefaultClient(client: LinkCodeSdkClient | null): void {
  defaultClient = client;
}

export function getDefaultClient(): LinkCodeSdkClient {
  return nullthrow(defaultClient, 'LinkCode SDK client has not been initialized');
}

export function resolveClient(options?: { client?: LinkCodeSdkClient }): LinkCodeSdkClient {
  return options?.client ?? getDefaultClient();
}

function toResult<T>(value: Promise<T>): RequestResult<T> {
  return value.then((data) => ({ data }));
}
