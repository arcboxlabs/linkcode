import type {
  HistoryListClientOptions,
  HistoryReadClientOptions,
  PluginList,
  PluginMutation,
  SessionStartResult,
} from '@linkcode/client-core';
import type {
  Account,
  AccountEndpoint,
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
import type { Options, RequestResult } from './client';
import { resolveClient } from './client';

export function listSessions(options?: Options): RequestResult<SessionInfo[]> {
  return resolveClient(options).listSessions();
}

export function startSession(options: Options<{ opts: StartOptions }>): RequestResult<SessionId> {
  return resolveClient(options).startSession(options.opts);
}

export function startSessionWithWarnings(
  options: Options<{ opts: StartOptions }>,
): RequestResult<SessionStartResult> {
  return resolveClient(options).startSessionWithWarnings(options.opts);
}

export function getAgentCatalog(
  options: Options<{ agentKind: AgentKind; cwd?: string }>,
): RequestResult<AgentStartCatalog> {
  return resolveClient(options).getAgentCatalog(options.agentKind, options.cwd);
}

export function stopSession(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).stopSession(options.sessionId);
}

export function deleteSession(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).deleteSession(options.sessionId);
}

export function listResources(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<SessionResource[]> {
  return resolveClient(options).listResources(options.sessionId);
}
export function uploadSource(
  options: Options<{ sessionId: SessionId; name: string; data: string; mimeType?: string }>,
): RequestResult<SessionResource> {
  return resolveClient(options).uploadSource(
    options.sessionId,
    options.name,
    options.data,
    options.mimeType,
  );
}
export function removeResource(
  options: Options<{ resourceId: SessionResourceId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).removeResource(options.resourceId);
}
export function hostResource(
  options: Options<{ resourceId: SessionResourceId }>,
): RequestResult<HostedSessionResource> {
  return resolveClient(options).hostResource(options.resourceId);
}

export function resumeSession(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<SessionId> {
  return resolveClient(options).resumeSession(options.sessionId);
}

export function resumeSessionWithWarnings(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<SessionStartResult> {
  return resolveClient(options).resumeSessionWithWarnings(options.sessionId);
}

export function importSession(
  options: Options<{ agentKind: AgentKind; historyId: AgentHistoryId }>,
): RequestResult<SessionRecord> {
  return resolveClient(options).importSession(options.agentKind, options.historyId);
}

export function listHistory(
  options: Options<{ agentKind: AgentKind; opts?: HistoryListClientOptions }>,
): RequestResult<AgentHistoryListResult> {
  return resolveClient(options).listHistory(options.agentKind, options.opts);
}

export function readHistory(
  options: Options<{ agentKind: AgentKind; opts: HistoryReadClientOptions }>,
): RequestResult<AgentHistoryReadResult> {
  return resolveClient(options).readHistory(options.agentKind, options.opts);
}

export function resumeHistory(
  options: Options<{ agentKind: AgentKind; historyId: AgentHistoryId; startOpts: StartOptions }>,
): RequestResult<SessionId> {
  return resolveClient(options).resumeHistory(
    options.agentKind,
    options.historyId,
    options.startOpts,
  );
}

export function resumeHistoryWithWarnings(
  options: Options<{ agentKind: AgentKind; historyId: AgentHistoryId; startOpts: StartOptions }>,
): RequestResult<SessionStartResult> {
  return resolveClient(options).resumeHistoryWithWarnings(
    options.agentKind,
    options.historyId,
    options.startOpts,
  );
}

export function rewritePrompt(
  options: Options<{
    sourceSessionId: SessionId;
    sourceMessageId: MessageId;
    branchCursor: AgentHistoryBranchCursor;
    content: ContentBlock[];
  }>,
): RequestResult<SessionId> {
  return resolveClient(options).rewritePrompt(
    options.sourceSessionId,
    options.sourceMessageId,
    options.branchCursor,
    options.content,
  );
}

export function sendInput(
  options: Options<{ sessionId: SessionId; input: AgentInput }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).sendInput(options.sessionId, options.input);
}

export function promptText(
  options: Options<{ sessionId: SessionId; text: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).promptText(options.sessionId, options.text);
}

export function invokeCommand(
  options: Options<{ sessionId: SessionId; name: string; arguments?: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).invokeCommand(options.sessionId, options.name, options.arguments);
}

export function runShellCommand(
  options: Options<{ sessionId: SessionId; command: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).runShellCommand(options.sessionId, options.command);
}

export function cancelTurn(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).cancel(options.sessionId);
}

export function setModel(
  options: Options<{ sessionId: SessionId; model: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).setModel(options.sessionId, options.model);
}

export function setEffort(
  options: Options<{ sessionId: SessionId; effort: EffortLevel }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).setEffort(options.sessionId, options.effort);
}

export function respondPermission(
  options: Options<{ sessionId: SessionId; requestId: string; outcome: PermissionOutcome }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).respondPermission(
    options.sessionId,
    options.requestId,
    options.outcome,
  );
}

export function respondQuestion(
  options: Options<{ sessionId: SessionId; requestId: string; outcome: QuestionOutcome }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).respondQuestion(
    options.sessionId,
    options.requestId,
    options.outcome,
  );
}

export function getProviderConfig(options?: Options): RequestResult<ProvidersConfig> {
  return resolveClient(options).getProviderConfig();
}

export function setProviderConfig(
  options: Options<{ providers: ProvidersConfig }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).setProviderConfig(options.providers);
}

export function createAndBindAccount(
  options: Options<{ agent: AgentKind; account: Account }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).createAndBindAccount(options.agent, options.account);
}

export function getAccounts(options?: Options): RequestResult<Accounts> {
  return resolveClient(options).getAccounts();
}

export function setAccounts(options: Options<{ accounts: Accounts }>): RequestResult<{ ok: true }> {
  return resolveClient(options).setAccounts(options.accounts);
}

export function probeAccountModels(
  options: Options<{ endpoint: AccountEndpoint; secret: AccountSecret }>,
): RequestResult<AccountModel[]> {
  return resolveClient(options).probeAccountModels(options.endpoint, options.secret);
}

/** Masked custom MCP servers — env/header keys only, never a secret value. */
export function getCustomMcpServers(options?: Options): RequestResult<CustomMcpServerPublic[]> {
  return resolveClient(options).getCustomMcpServers();
}

export function setCustomMcpServers(
  options: Options<{ patches: CustomMcpServerPatchOp[] }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).setCustomMcpServers(options.patches);
}

/** Discover provider plugins + standalone skills. Slow (a CLI shell-out on the daemon) —
 * consumers refresh manually, never on focus. */
export function getPlugins(options?: Options<{ cwd?: string }>): RequestResult<PluginList> {
  return resolveClient(options).listPlugins(options?.cwd);
}

/** Toggle a plugin; resolves with the re-listed plugin so callers patch one cache entry. */
export function setPluginEnabled(
  options: Options<{
    provider: PluginProvider;
    id: string;
    enabled: boolean;
    scope?: PluginScope;
    cwd?: string;
  }>,
): RequestResult<PluginMutation> {
  const { provider, id, enabled, scope, cwd } = options;
  return resolveClient(options).setPluginEnabled({ provider, id, enabled, scope, cwd });
}

/** Install a catalog entry. Only providers reporting `managementCapabilities.install` accept it;
 * the result names any provider apps the install left unauthorized. */
export function installPlugin(
  options: Options<{ provider: PluginProvider; id: string; cwd?: string }>,
): RequestResult<PluginMutation> {
  const { provider, id, cwd } = options;
  return resolveClient(options).installPlugin({ provider, id, cwd });
}

/** Uninstall a plugin; resolves with the marketplace entry that survives, now uninstalled. */
export function uninstallPlugin(
  options: Options<{ provider: PluginProvider; id: string; cwd?: string }>,
): RequestResult<PluginMutation> {
  const { provider, id, cwd } = options;
  return resolveClient(options).uninstallPlugin({ provider, id, cwd });
}

/** Toggle one skill; resolves with the re-read skill so callers patch one cache entry. */
export function setSkillEnabled(
  options: Options<{
    provider: PluginProvider;
    skillId: string;
    path: string;
    scope?: StandaloneSkillScope;
    enabled: boolean;
    cwd?: string;
  }>,
): RequestResult<StandaloneSkill> {
  const { provider, skillId, path, scope, enabled, cwd } = options;
  return resolveClient(options).setSkillEnabled({ provider, skillId, path, scope, enabled, cwd });
}

/** Which agent CLIs the host can actually spawn (probed once at daemon boot). */
export function listAgentRuntimes(options?: Options): RequestResult<AgentRuntimes> {
  return resolveClient(options).listAgentRuntimes();
}

/** Managed-asset store status: wanted versions and what is installed (CODE-111). */
export function listAssets(options?: Options): RequestResult<ManagedAssetStatus[]> {
  return resolveClient(options).listAssets();
}

/** Install a managed asset; resolves when the install settles (progress rides `asset.progress`). */
export function ensureAsset(
  options: Options<{ id: ManagedAssetId }>,
): RequestResult<ManagedAssetStatus> {
  return resolveClient(options).ensureAsset(options.id);
}

/** Local git facts for a directory (directory-backed: keyed by cwd, not by session). */
export function getGitStatus(options: Options<{ cwd: string }>): RequestResult<GitStatus> {
  return resolveClient(options).getGitStatus(options.cwd);
}

/** Local branches for a directory, ordered current-first then by descending commit date. */
export function listGitBranches(options: Options<{ cwd: string }>): RequestResult<GitBranchList> {
  return resolveClient(options).listGitBranches(options.cwd);
}

export function checkGitBranchSwitch(
  options: Options<{ cwd: string; branch: string }>,
): RequestResult<GitBranchSwitchCheck> {
  return resolveClient(options).checkGitBranchSwitch(options.cwd, options.branch);
}

export function createGitBranch(
  options: Options<{ cwd: string; branch: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).createGitBranch(options.cwd, options.branch);
}

export function commitGitChanges(
  options: Options<{ cwd: string; message: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).commitGitChanges(options.cwd, options.message);
}

/** Hosting-provider PR state for a directory's current branch. */
export function getGitPullRequestStatus(
  options: Options<{ cwd: string }>,
): RequestResult<GitPullRequestStatus> {
  return resolveClient(options).getGitPullRequestStatus(options.cwd);
}

/** A unified-diff patch for a directory (directory-backed: keyed by cwd, not by session). */
export function getGitDiff(
  options: Options<{ cwd: string; mode: GitDiffMode }>,
): RequestResult<GitDiff> {
  return resolveClient(options).getGitDiff(options.cwd, options.mode);
}

/** Read a file contained to a workspace directory (directory-backed, like git.*). */
export function readWorkspaceFile(
  options: Options<{ cwd: string; path: string }>,
): RequestResult<WorkspaceFile> {
  return resolveClient(options).readFile(options.cwd, options.path);
}

/** Every workspace file as a cwd-relative path. Like file.suggest, `cwd` must be a
 * registered workspace root (session start/resume registers it); unknown roots are rejected. */
export function listWorkspaceFiles(options: Options<{ cwd: string }>): RequestResult<string[]> {
  return resolveClient(options).listFiles(options.cwd);
}

/** Search workspace files by substring query. Unlike file.read/git.*, `cwd` must be a
 * registered workspace root (session start/resume registers it); unknown roots are rejected. */
export function suggestWorkspaceFiles(
  options: Options<{ cwd: string; query: string; limit?: number }>,
): RequestResult<FileSuggestion[]> {
  return resolveClient(options).suggestFiles(options.cwd, options.query, options.limit);
}

/** The workspace's declared scripts with live lifecycle/health (directory-backed). */
export function listWorkspaceScripts(
  options: Options<{ cwd: string }>,
): RequestResult<WorkspaceScript[]> {
  return resolveClient(options).listScripts(options.cwd);
}

export function startWorkspaceScript(
  options: Options<{ cwd: string; scriptName: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).startScript(options.cwd, options.scriptName);
}

export function stopWorkspaceScript(
  options: Options<{ cwd: string; scriptName: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).stopScript(options.cwd, options.scriptName);
}

/** Host inline artifact content on the daemon's ephemeral per-artifact origin. */
export function hostArtifact(
  options: Options<{ content: string; mimeType: string }>,
): RequestResult<HostedArtifact> {
  return resolveClient(options).hostArtifact(options.content, options.mimeType);
}

/** Host a workspace file (directory-backed) on the daemon's per-file origin, streamed with
 * Range so the host's browser plays large media inline (CODE-316). */
export function hostWorkspaceFile(
  options: Options<{ cwd: string; path: string }>,
): RequestResult<HostedFile> {
  return resolveClient(options).hostFile(options.cwd, options.path);
}

/** Every registered workspace (directory), most recently used first. */
export function listWorkspaces(options?: Options): RequestResult<WorkspaceRecord[]> {
  return resolveClient(options).listWorkspaces();
}

/** Register a directory as a workspace; idempotent for an already-registered directory. */
export function registerWorkspace(
  options: Options<{ cwd: string; name?: string; kind?: WorkspaceKind }>,
): RequestResult<WorkspaceRecord> {
  return resolveClient(options).registerWorkspace(options.cwd, options.name, options.kind);
}

export function updateWorkspace(
  options: Options<{ workspaceId: WorkspaceId; name: string }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).updateWorkspace(options.workspaceId, options.name);
}

/** Drop a workspace from the registry; never touches the directory on disk. */
export function archiveWorkspace(
  options: Options<{ workspaceId: WorkspaceId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).archiveWorkspace(options.workspaceId);
}

/** Every schedule the daemon holds (active, paused, and completed). */
export function listSchedules(options?: Options): RequestResult<Schedule[]> {
  return resolveClient(options).listSchedules();
}

export function createSchedule(options: Options<{ spec: ScheduleSpec }>): RequestResult<Schedule> {
  return resolveClient(options).createSchedule(options.spec);
}

export function updateSchedule(
  options: Options<{ scheduleId: ScheduleId; patch: ScheduleUpdate }>,
): RequestResult<Schedule> {
  return resolveClient(options).updateSchedule(options.scheduleId, options.patch);
}

export function deleteSchedule(
  options: Options<{ scheduleId: ScheduleId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).deleteSchedule(options.scheduleId);
}

export function pauseSchedule(
  options: Options<{ scheduleId: ScheduleId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).pauseSchedule(options.scheduleId);
}

export function resumeSchedule(
  options: Options<{ scheduleId: ScheduleId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).resumeSchedule(options.scheduleId);
}

export function runScheduleOnce(
  options: Options<{ scheduleId: ScheduleId }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).runScheduleOnce(options.scheduleId);
}

export function listScheduleRuns(
  options: Options<{ scheduleId: ScheduleId; limit?: number }>,
): RequestResult<ScheduleRun[]> {
  return resolveClient(options).listScheduleRuns(options.scheduleId, options.limit);
}

/** Every loop the daemon holds (running and settled). */
export function listLoops(options?: Options): RequestResult<LoopRecord[]> {
  return resolveClient(options).listLoops();
}

export function startLoop(options: Options<{ spec: LoopSpec }>): RequestResult<LoopRecord> {
  return resolveClient(options).startLoop(options.spec);
}

export function stopLoop(options: Options<{ loopId: LoopId }>): RequestResult<{ ok: true }> {
  return resolveClient(options).stopLoop(options.loopId);
}

export function deleteLoop(options: Options<{ loopId: LoopId }>): RequestResult<{ ok: true }> {
  return resolveClient(options).deleteLoop(options.loopId);
}

export function inspectLoop(options: Options<{ loopId: LoopId }>): RequestResult<LoopInspection> {
  return resolveClient(options).inspectLoop(options.loopId);
}
