import type {
  AgentEvent,
  AgentInput,
  ContentBlock,
  GitDiff,
  GitPullRequestStatus,
  GitStatus,
  MessageId,
  PermissionOutcome,
  ProvidersConfig,
  SessionId,
  SessionInfo,
  SessionStatus,
  ToolCall,
  WireMessage,
  WirePayload,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import { normalizeCwdKey, textBlock } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { wait } from 'foxts/wait';
import {
  CHUNK_LATENCY_MS,
  CONTROL_LATENCY_MS,
  FAIL_PROMPT,
  MOCK_REPLY,
  WORD_CHUNK_PATTERN,
} from './data/prompt';
import { SEED_SESSIONS, SHOWCASE_TERMINAL_ID } from './data/sessions';
import {
  createShowcaseToolSnapshots,
  SHOWCASE_ARCHITECTURE_LINK,
  SHOWCASE_EMBEDDED_RESOURCE,
  SHOWCASE_ERROR_EVENT,
  SHOWCASE_IMAGE,
  SHOWCASE_INTRO_CONTENT,
  SHOWCASE_PERMISSION_DENIED_CONTENT,
  SHOWCASE_PERMISSION_DIFF,
  SHOWCASE_PERMISSION_GRANTED_CONTENT,
  SHOWCASE_PERMISSION_ID,
  SHOWCASE_PERMISSION_OPTIONS,
  SHOWCASE_PERMISSION_TOOL_ID,
  SHOWCASE_PLAN,
  SHOWCASE_SCRIPT_START_DELAY_MS,
  SHOWCASE_SCRIPT_STEP_LATENCY_MS,
  SHOWCASE_STREAM_CHUNK_LATENCY_MS,
  SHOWCASE_STREAM_REPLY,
  SHOWCASE_STREAM_START_DELAY_MS,
  SHOWCASE_STREAM_THOUGHT_CONTENT,
  SHOWCASE_TERMINAL_EXIT_OUTPUT,
  SHOWCASE_TERMINAL_START_OUTPUT,
  SHOWCASE_THOUGHT_CONTENT,
  SHOWCASE_USER_CONTENT,
} from './data/showcase';

interface MockSession extends SessionInfo {
  /** Host-only state: keep it off `session.list` so the mock still crosses the schema boundary cleanly. */
  model?: string;
  /** Bumped by cancel/stop so an in-flight prompt turn knows to bail out. */
  epoch: number;
  showcase?: boolean;
  showcaseSeeded?: boolean;
  terminalId?: string;
}

interface PendingPermission {
  sessionId: SessionId;
  toolCallId: string;
  diff: Extract<ToolCall['content'][number], { type: 'diff' }>;
}

const MOCK_GIT_DIFF: GitDiff = {
  patch:
    "diff --git a/mock.ts b/mock.ts\nindex 0000000..1111111 100644\n--- a/mock.ts\n+++ b/mock.ts\n@@ -1 +1 @@\n-const mode = 'daemon';\n+const mode = 'mock';\n",
  truncated: false,
  stat: { files: 1, additions: 1, deletions: 1 },
};

const MOCK_PR_STATUS: GitPullRequestStatus = {
  status: 'ok',
  pullRequest: {
    provider: 'github',
    number: 42,
    title: 'Mock host data-plane coverage',
    url: 'https://github.com/linkcode/mock/pull/42',
    state: 'open',
    isDraft: false,
    baseBranch: 'main',
    headBranch: 'mock-host',
    checks: 'passing',
    reviewDecision: 'approved',
  },
};

export class DevMockHost {
  private readonly sessions = new Map<SessionId, MockSession>();
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();
  private providers: ProvidersConfig = {};
  private readonly permissions = new Map<string, PendingPermission>();
  private sessionSeq = 0;
  private messageSeq = 0;
  private workspaceSeq = 0;

  constructor(private readonly transport: Transport) {}

  start(): void {
    void this.transport.connect();
    this.transport.onMessage((msg) => {
      void this.handle(msg);
    });
    const now = Date.now();
    for (const { ageMs, ...seed } of SEED_SESSIONS) {
      const createdAt = now - ageMs;
      this.addSession({ ...seed, createdAt });
      this.touchWorkspace(seed.cwd, createdAt);
    }
  }

  private async handle(msg: WireMessage): Promise<void> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'session.listed',
          replyTo: p.clientReqId,
          sessions: [...this.sessions.values()].map((session) => toSessionInfo(session)),
        });
        // Start after the list reply so the UI can subscribe before scripted frames arrive.
        this.startShowcase();
        break;
      case 'session.start':
        await wait(CONTROL_LATENCY_MS);
        this.startSession(p.clientReqId, p.opts.kind, p.opts.cwd, p.opts.model);
        break;
      case 'session.resume':
        await wait(CONTROL_LATENCY_MS);
        this.resumeSession(p.clientReqId, p.sessionId);
        break;
      case 'session.stop':
        await wait(CONTROL_LATENCY_MS);
        this.stopSession(p.clientReqId, p.sessionId);
        break;
      case 'agent.input':
        await this.handleInput(p.clientReqId, p.sessionId, p.input);
        break;
      case 'config.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({ kind: 'config.get.result', replyTo: p.clientReqId, providers: this.providers });
        break;
      case 'config.set':
        await wait(CONTROL_LATENCY_MS);
        this.providers = structuredClone(p.providers);
        this.sendSuccess(p.clientReqId);
        break;
      case 'workspace.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'workspace.listed',
          replyTo: p.clientReqId,
          workspaces: this.listWorkspaces(),
        });
        break;
      case 'workspace.register':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'workspace.registered',
          replyTo: p.clientReqId,
          record: this.touchWorkspace(p.cwd, Date.now(), p.name),
        });
        break;
      case 'workspace.update':
        await wait(CONTROL_LATENCY_MS);
        this.updateWorkspace(p.clientReqId, p.workspaceId, p.name);
        break;
      case 'workspace.archive':
        await wait(CONTROL_LATENCY_MS);
        this.archiveWorkspace(p.workspaceId);
        this.sendSuccess(p.clientReqId);
        break;
      case 'git.status.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'git.status.get.result',
          replyTo: p.clientReqId,
          status: mockGitStatus(p.cwd),
        });
        break;
      case 'git.pr_status.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'git.pr_status.get.result',
          replyTo: p.clientReqId,
          prStatus: MOCK_PR_STATUS,
        });
        break;
      case 'git.diff.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({ kind: 'git.diff.get.result', replyTo: p.clientReqId, diff: MOCK_GIT_DIFF });
        break;
      case 'session.import':
        this.sendFailure(p.clientReqId, 'Dev mock host does not support importing sessions yet.');
        break;
      case 'history.list':
      case 'history.read':
      case 'history.resume':
        // Fail loudly for unmocked surfaces so correlated SDK calls reject instead of hanging forever.
        this.sendFailure(p.clientReqId, 'Dev mock host does not support history yet.');
        break;
      case 'terminal.open':
        this.sendFailure(p.clientReqId, 'Dev mock host does not support terminals yet.');
        break;
      case 'ping':
        this.send({ kind: 'pong' });
        break;
      default:
        break;
    }
  }

  private addSession(
    init: Omit<MockSession, 'sessionId' | 'origin' | 'epoch' | 'status'> & {
      status: SessionStatus;
    },
  ): MockSession {
    const session: MockSession = {
      ...init,
      sessionId: this.nextSessionId(),
      origin: { type: 'created' },
      epoch: 0,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private listWorkspaces(): WorkspaceRecord[] {
    return [...this.workspaces.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  private touchWorkspace(cwd: string, now: number, name?: string): WorkspaceRecord {
    const key = normalizeCwdKey(cwd);
    for (const workspace of this.workspaces.values()) {
      if (normalizeCwdKey(workspace.cwd) !== key) continue;
      workspace.lastUsedAt = Math.max(workspace.lastUsedAt, now);
      return workspace;
    }
    const workspace: WorkspaceRecord = {
      workspaceId: this.nextWorkspaceId(),
      cwd,
      name: name ?? lastPathSegment(cwd),
      createdAt: now,
      lastUsedAt: now,
    };
    this.workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  private updateWorkspace(replyTo: string, workspaceId: WorkspaceId, name: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      this.sendFailure(replyTo, `Unknown workspace: ${workspaceId}`);
      return;
    }
    workspace.name = name;
    this.sendSuccess(replyTo);
  }

  private archiveWorkspace(workspaceId: WorkspaceId): void {
    this.workspaces.delete(workspaceId);
  }

  private startSession(
    replyTo: string,
    kind: MockSession['kind'],
    cwd: string,
    model: string | undefined,
  ): void {
    const session = this.addSession({ kind, cwd, status: 'idle', createdAt: Date.now(), model });
    const { sessionId } = session;
    this.emit(sessionId, { type: 'status', status: 'starting' });
    this.emit(sessionId, { type: 'current-mode-update', currentModeId: 'mock' });
    this.emit(sessionId, { type: 'status', status: 'idle' });
    this.send({ kind: 'session.started', replyTo, sessionId });
  }

  private resumeSession(replyTo: string, sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendFailure(replyTo, `Unknown session: ${sessionId}`);
      return;
    }
    // Parity with the engine: only cold sessions can be resumed.
    if (session.status !== 'stopped') {
      this.sendFailure(replyTo, `Session is already running: ${sessionId}`);
      return;
    }
    session.status = 'idle';
    this.emit(sessionId, { type: 'status', status: 'idle' });
    this.send({ kind: 'session.started', replyTo, sessionId });
  }

  private stopSession(replyTo: string, sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendFailure(replyTo, `Unknown session: ${sessionId}`);
      return;
    }
    session.epoch += 1;
    session.status = 'stopped';
    this.emit(sessionId, { type: 'status', status: 'stopped' });
    this.sendSuccess(replyTo);
  }

  private async handleInput(
    replyTo: string,
    sessionId: SessionId,
    input: AgentInput,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendFailure(replyTo, `Unknown session: ${sessionId}`);
      return;
    }
    // Parity with the engine, which only routes input to live sessions.
    if (session.status === 'stopped') {
      this.sendFailure(replyTo, `Session is stopped, resume it first: ${sessionId}`);
      return;
    }

    switch (input.type) {
      case 'prompt':
        await this.prompt(replyTo, session, input.content);
        break;
      case 'cancel':
        session.epoch += 1;
        session.status = 'idle';
        this.emit(sessionId, { type: 'stop', stopReason: 'cancelled' });
        this.emit(sessionId, { type: 'status', status: 'idle' });
        this.sendSuccess(replyTo);
        break;
      case 'set-model':
        session.model = input.model;
        this.sendSuccess(replyTo);
        break;
      case 'set-mode':
        this.emit(sessionId, { type: 'current-mode-update', currentModeId: input.modeId });
        this.sendSuccess(replyTo);
        break;
      case 'permission-response':
        this.respondPermission(replyTo, sessionId, input.requestId, input.outcome);
        break;
      default:
        this.sendFailure(replyTo, 'Dev mock host does not support that input yet.');
        break;
    }
  }

  private async prompt(
    replyTo: string,
    session: MockSession,
    content: ContentBlock[],
  ): Promise<void> {
    const text = promptText(content);
    if (!session.title && text) session.title = text.slice(0, 80);
    session.status = 'running';
    this.emit(session.sessionId, { type: 'user-message', content });
    this.emit(session.sessionId, { type: 'status', status: 'running' });

    // Cancel/stop bump the session epoch; a stale epoch means this turn was cancelled and the
    // cancel handler already emitted the terminal events — just ack the prompt and bail.
    const epoch = session.epoch;
    const cancelledAfter = async (ms: number): Promise<boolean> => {
      await wait(ms);
      return session.epoch !== epoch;
    };

    if (await cancelledAfter(200)) {
      this.sendSuccess(replyTo);
      return;
    }
    const thoughtId = this.nextMessageId('mock-thought');
    this.emit(session.sessionId, {
      type: 'agent-thought-chunk',
      messageId: thoughtId,
      content: textBlock('Reading the mocked request.'),
    });

    if (text.toLowerCase() === FAIL_PROMPT) {
      if (await cancelledAfter(200)) {
        this.sendSuccess(replyTo);
        return;
      }
      const message = `Mock failure requested via the "${FAIL_PROMPT}" prompt.`;
      this.emit(session.sessionId, { type: 'error', message, recoverable: true });
      session.status = 'idle';
      this.emit(session.sessionId, { type: 'status', status: 'idle' });
      this.sendFailure(replyTo, message);
      return;
    }

    const messageId = this.nextMessageId('mock-message');
    const reply = `${MOCK_REPLY}\n\nModel: ${session.model ?? 'mock-default'}\nYou said: ${text || '(empty prompt)'}`;
    for (const chunk of reply.match(WORD_CHUNK_PATTERN) ?? []) {
      if (await cancelledAfter(CHUNK_LATENCY_MS)) {
        this.sendSuccess(replyTo);
        return;
      }
      this.emit(session.sessionId, {
        type: 'agent-message-chunk',
        messageId,
        content: textBlock(chunk),
      });
    }
    this.emit(session.sessionId, {
      type: 'token-usage',
      usage: {
        inputTokens: Math.max(1, Math.ceil(text.length / 4)),
        outputTokens: 32,
      },
    });
    this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
    this.sendSuccess(replyTo);
  }

  private startShowcase(): void {
    for (const session of this.sessions.values()) {
      if (!session.showcase) continue;
      if (session.showcaseSeeded) continue;
      session.showcaseSeeded = true;
      void this.runShowcase(session);
    }
  }

  private async runShowcase(session: MockSession): Promise<void> {
    session.status = 'running';
    const epoch = session.epoch;
    await wait(SHOWCASE_SCRIPT_START_DELAY_MS);
    if (!isRunningTurn(session, epoch)) return;
    if (!(await this.emitShowcaseConversation(session, epoch))) return;
    await this.streamShowcaseReply(session, epoch);
  }

  private async emitShowcaseConversation(session: MockSession, epoch: number): Promise<boolean> {
    const introId = this.nextMessageId('mock-showcase-intro');
    const resourceId = this.nextMessageId('mock-showcase-resource');
    const terminalId = session.terminalId ?? SHOWCASE_TERMINAL_ID;
    this.permissions.set(SHOWCASE_PERMISSION_ID, {
      sessionId: session.sessionId,
      toolCallId: SHOWCASE_PERMISSION_TOOL_ID,
      diff: SHOWCASE_PERMISSION_DIFF,
    });

    const script: AgentEvent[] = [
      { type: 'status', status: 'running' },
      { type: 'current-mode-update', currentModeId: 'mock-showcase' },
      { type: 'user-message', content: SHOWCASE_USER_CONTENT },
      {
        type: 'agent-thought-chunk',
        messageId: this.nextMessageId('mock-showcase-thought'),
        content: SHOWCASE_THOUGHT_CONTENT,
      },
      { type: 'plan', plan: SHOWCASE_PLAN },
      {
        type: 'agent-message-chunk',
        messageId: introId,
        content: SHOWCASE_INTRO_CONTENT,
      },
      {
        type: 'agent-message-chunk',
        messageId: introId,
        content: SHOWCASE_ARCHITECTURE_LINK,
      },
      {
        type: 'agent-message-chunk',
        messageId: resourceId,
        content: SHOWCASE_EMBEDDED_RESOURCE,
      },
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-image'),
        content: SHOWCASE_IMAGE,
      },
      ...createShowcaseToolSnapshots(terminalId).map(
        (toolCall): AgentEvent => ({ type: 'tool-call', toolCall }),
      ),
    ];

    for (const event of script) {
      if (!(await waitForShowcaseStep(session, epoch))) return false;
      this.emit(session.sessionId, event);
    }
    if (!(await waitForShowcaseStep(session, epoch))) return false;
    this.send({ kind: 'terminal.output', terminalId, data: SHOWCASE_TERMINAL_START_OUTPUT });
    if (
      !(await this.emitShowcaseEvent(session, epoch, {
        type: 'permission-request',
        requestId: SHOWCASE_PERMISSION_ID,
        toolCall: {
          toolCallId: SHOWCASE_PERMISSION_TOOL_ID,
          title: 'Apply guarded edit',
          kind: 'edit',
          status: 'pending',
          content: [SHOWCASE_PERMISSION_DIFF],
        },
        options: SHOWCASE_PERMISSION_OPTIONS,
      }))
    ) {
      return false;
    }
    return this.emitShowcaseEvent(session, epoch, SHOWCASE_ERROR_EVENT);
  }

  private async emitShowcaseEvent(
    session: MockSession,
    epoch: number,
    event: AgentEvent,
  ): Promise<boolean> {
    if (!(await waitForShowcaseStep(session, epoch))) return false;
    this.emit(session.sessionId, event);
    return true;
  }

  private async streamShowcaseReply(session: MockSession, epoch: number): Promise<void> {
    const terminalId = session.terminalId ?? SHOWCASE_TERMINAL_ID;
    const thoughtId = this.nextMessageId('mock-showcase-stream-thought');
    const messageId = this.nextMessageId('mock-showcase-stream');
    await wait(SHOWCASE_STREAM_START_DELAY_MS);
    if (!isRunningTurn(session, epoch)) return;
    this.emit(session.sessionId, {
      type: 'agent-thought-chunk',
      messageId: thoughtId,
      content: SHOWCASE_STREAM_THOUGHT_CONTENT,
    });

    for (const chunk of SHOWCASE_STREAM_REPLY.match(WORD_CHUNK_PATTERN) ?? []) {
      await wait(SHOWCASE_STREAM_CHUNK_LATENCY_MS);
      if (!isRunningTurn(session, epoch)) return;
      this.emit(session.sessionId, {
        type: 'agent-message-chunk',
        messageId,
        content: textBlock(chunk),
      });
    }
    this.send({ kind: 'terminal.output', terminalId, data: SHOWCASE_TERMINAL_EXIT_OUTPUT });
    this.emit(session.sessionId, {
      type: 'token-usage',
      usage: { inputTokens: 148, outputTokens: 96, totalCostUsd: 0 },
    });
    this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
  }

  private respondPermission(
    replyTo: string,
    sessionId: SessionId,
    requestId: string,
    outcome: PermissionOutcome,
  ): void {
    const pending = this.permissions.get(requestId);
    if (pending?.sessionId !== sessionId) {
      this.sendFailure(replyTo, `Unknown permission request: ${requestId}`);
      return;
    }
    this.permissions.delete(requestId);
    const allowed = outcome.outcome === 'selected' && outcome.optionId.startsWith('allow');
    this.emitToolSnapshot(sessionId, {
      toolCallId: pending.toolCallId,
      title: 'Apply guarded edit',
      kind: 'edit',
      status: allowed ? 'completed' : 'failed',
      content: [
        pending.diff,
        {
          type: 'content',
          content: allowed
            ? SHOWCASE_PERMISSION_GRANTED_CONTENT
            : SHOWCASE_PERMISSION_DENIED_CONTENT,
        },
      ],
      rawOutput: { outcome },
    });
    this.sendSuccess(replyTo);
  }

  private emitToolSnapshot(sessionId: SessionId, toolCall: ToolCall): void {
    this.emit(sessionId, { type: 'tool-call', toolCall });
  }

  private emit(sessionId: SessionId, event: AgentEvent): void {
    this.send({ kind: 'agent.event', sessionId, event });
  }

  private send(payload: WirePayload): void {
    this.transport.send(createWireMessage(payload));
  }

  private sendSuccess(replyTo: string): void {
    this.send({ kind: 'request.succeeded', replyTo });
  }

  private sendFailure(replyTo: string, message: string): void {
    this.send({ kind: 'request.failed', replyTo, message });
  }

  private nextSessionId(): SessionId {
    this.sessionSeq += 1;
    return `mock-sess-${Date.now().toString(36)}-${this.sessionSeq.toString(36)}` as SessionId;
  }

  private nextMessageId(prefix: string): MessageId {
    this.messageSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.messageSeq.toString(36)}` as MessageId;
  }

  private nextWorkspaceId(): WorkspaceId {
    this.workspaceSeq += 1;
    return `mock-ws-${Date.now().toString(36)}-${this.workspaceSeq.toString(36)}` as WorkspaceId;
  }
}

function promptText(content: readonly ContentBlock[]): string {
  return content
    .reduce((text, block) => {
      if (block.type !== 'text') return text;
      return text ? `${text}\n${block.text}` : block.text;
    }, '')
    .trim();
}

function toSessionInfo(session: MockSession): SessionInfo {
  return {
    sessionId: session.sessionId,
    kind: session.kind,
    cwd: session.cwd,
    status: session.status,
    createdAt: session.createdAt,
    title: session.title,
    origin: session.origin,
  };
}

function isRunningTurn(session: MockSession, epoch: number): boolean {
  return session.epoch === epoch && session.status === 'running';
}

async function waitForShowcaseStep(session: MockSession, epoch: number): Promise<boolean> {
  await wait(SHOWCASE_SCRIPT_STEP_LATENCY_MS);
  return isRunningTurn(session, epoch);
}

function mockGitStatus(cwd: string): GitStatus {
  return {
    isRepo: true,
    repoRoot: cwd,
    branch: 'mock-host',
    dirtyFileCount: 1,
    ahead: 1,
    behind: 0,
    remote: {
      url: 'https://github.com/linkcode/mock.git',
      identity: {
        provider: 'github',
        host: 'github.com',
        owner: 'linkcode',
        repo: 'mock',
      },
    },
  };
}

const PATH_SEPARATORS_RE = /[/\\]+/;

function lastPathSegment(cwd: string): string {
  return cwd.split(PATH_SEPARATORS_RE).findLast((part) => part.length > 0) ?? cwd;
}
