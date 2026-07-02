import type { HistoryListClientOptions, HistoryReadClientOptions } from '@linkcode/client-core';
import { LinkCodeClient } from '@linkcode/client-core';
import type {
  AgentHistoryId,
  AgentHistoryListResult,
  AgentHistoryReadResult,
  AgentInput,
  AgentKind,
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
  WorkspaceId,
  WorkspaceRecord,
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

  dispose(): void {
    this.raw.dispose();
  }

  listSessions(): RequestResult<SessionInfo[]> {
    return toResult(this.raw.listSessions());
  }

  startSession(opts: StartOptions): RequestResult<SessionId> {
    return toResult(this.raw.startSession(opts));
  }

  stopSession(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.stopSession(sessionId));
  }

  /** Resume a persisted (cold) session by its Link Code id; resolves with the same id. */
  resumeSession(sessionId: SessionId): RequestResult<SessionId> {
    return toResult(this.raw.resumeSession(sessionId));
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

  sendInput(sessionId: SessionId, input: AgentInput): RequestResult<{ ok: true }> {
    return toResult(this.raw.send(sessionId, input));
  }

  promptText(sessionId: SessionId, text: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.promptText(sessionId, text));
  }

  cancel(sessionId: SessionId): RequestResult<{ ok: true }> {
    return toResult(this.raw.cancel(sessionId));
  }

  setModel(sessionId: SessionId, model: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.setModel(sessionId, model));
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

  /** Read the daemon-owned provider config (data plane). */
  getProviderConfig(): RequestResult<ProvidersConfig> {
    return toResult(this.raw.getProviderConfig());
  }

  /** Persist the daemon-owned provider config (data plane). */
  setProviderConfig(providers: ProvidersConfig): RequestResult<{ ok: true }> {
    return toResult(this.raw.setProviderConfig(providers));
  }

  /** Local git facts for a directory (directory-backed: keyed by cwd, not by session). */
  getGitStatus(cwd: string): RequestResult<GitStatus> {
    return toResult(this.raw.getGitStatus(cwd));
  }

  /** Hosting-provider PR state for a directory's current branch. */
  getGitPullRequestStatus(cwd: string): RequestResult<GitPullRequestStatus> {
    return toResult(this.raw.getGitPullRequestStatus(cwd));
  }

  /** A unified-diff patch for a directory (directory-backed: keyed by cwd, not by session). */
  getGitDiff(cwd: string, mode: GitDiffMode): RequestResult<GitDiff> {
    return toResult(this.raw.getGitDiff(cwd, mode));
  }

  /** Every registered workspace (directory), most recently used first. */
  listWorkspaces(): RequestResult<WorkspaceRecord[]> {
    return toResult(this.raw.listWorkspaces());
  }

  /** Register a directory as a workspace; idempotent for an already-registered directory. */
  registerWorkspace(cwd: string, name?: string): RequestResult<WorkspaceRecord> {
    return toResult(this.raw.registerWorkspace(cwd, name));
  }

  updateWorkspace(workspaceId: WorkspaceId, name: string): RequestResult<{ ok: true }> {
    return toResult(this.raw.updateWorkspace(workspaceId, name));
  }

  /** Drop a workspace from the registry; never touches the directory on disk. */
  archiveWorkspace(workspaceId: WorkspaceId): RequestResult<{ ok: true }> {
    return toResult(this.raw.archiveWorkspace(workspaceId));
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
