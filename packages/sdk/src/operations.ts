import type { HistoryListClientOptions, HistoryReadClientOptions } from '@linkcode/client-core';
import type {
  AgentHistoryId,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
  GitPullRequestStatus,
  GitStatus,
  PermissionOutcome,
  ProvidersConfig,
  SessionId,
  SessionInfo,
  SessionRecord,
  StartOptions,
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
