import type { HistoryListClientOptions, HistoryReadClientOptions } from '@linkcode/client-core';
import type {
  AgentHistoryId,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
  AgentRuntimes,
  EffortLevel,
  GitDiff,
  GitDiffMode,
  GitPullRequestStatus,
  GitStatus,
  HostedArtifact,
  ManagedAssetStatus,
  PermissionOutcome,
  ProvidersConfig,
  SessionId,
  SessionInfo,
  SessionRecord,
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

export function resumeSession(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<SessionId> {
  return resolveClient(options).resumeSession(options.sessionId);
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

export function getProviderConfig(options?: Options): RequestResult<ProvidersConfig> {
  return resolveClient(options).getProviderConfig();
}

export function setProviderConfig(
  options: Options<{ providers: ProvidersConfig }>,
): RequestResult<{ ok: true }> {
  return resolveClient(options).setProviderConfig(options.providers);
}

/** Which agent CLIs the host can actually spawn (probed once at daemon boot). */
export function listAgentRuntimes(options?: Options): RequestResult<AgentRuntimes> {
  return resolveClient(options).listAgentRuntimes();
}

/** Managed-asset store status: wanted versions and what is installed (CODE-111). */
export function listAssets(options?: Options): RequestResult<ManagedAssetStatus[]> {
  return resolveClient(options).listAssets();
}

/** Local git facts for a directory (directory-backed: keyed by cwd, not by session). */
export function getGitStatus(options: Options<{ cwd: string }>): RequestResult<GitStatus> {
  return resolveClient(options).getGitStatus(options.cwd);
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
