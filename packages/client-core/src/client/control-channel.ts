import type {
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
  HostedArtifact,
  PermissionOutcome,
  ProvidersConfig,
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
import type { PendingRegistry, PendingValueMap, RequestAck } from './pending-registry';
import { sendCorrelated } from './pending-registry';

export type HistoryListClientOptions = AgentHistoryListOptions & {
  forceRefresh?: boolean;
};

export type HistoryReadClientOptions = AgentHistoryReadOptions & {
  forceRefresh?: boolean;
};

/**
 * The correlated control-plane requests: session lifecycle, history, provider config, git facts,
 * and workspaces. Each method builds the matching `WirePayload` and hands it to the shared
 * {@link PendingRegistry} for request/reply correlation (see {@link sendCorrelated}).
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

  /** Persist the daemon-owned provider config (data plane). */
  setProviderConfig(providers: ProvidersConfig): Promise<RequestAck> {
    return this.sendCorrelated('ack', (clientReqId) => ({
      kind: 'config.set',
      clientReqId,
      providers,
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

  private sendCorrelated<K extends keyof PendingValueMap>(
    kind: K,
    makePayload: (clientReqId: string) => WirePayload,
  ): Promise<PendingValueMap[K]> {
    return sendCorrelated(this.transport, this.pending, kind, makePayload);
  }
}
