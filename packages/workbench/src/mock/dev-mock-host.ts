import type {
  AgentEvent,
  AgentHistoryId,
  AgentHistorySession,
  AgentInput,
  AgentKind,
  ContentBlock,
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
  WorkspaceScript,
} from '@linkcode/schema';
import { normalizeCwdKey, textBlock } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { wait } from 'foxts/wait';
import { mockFileFixture } from './data/files';
import { gitFixtureFor } from './data/git';
import { SEED_HISTORY } from './data/history';
import {
  CHUNK_LATENCY_MS,
  CONTROL_LATENCY_MS,
  FAIL_PROMPT,
  MOCK_REPLY,
  WORD_CHUNK_PATTERN,
} from './data/prompt';
import { mockScriptDeclarations } from './data/scripts';
import { SEED_SESSIONS, SHOWCASE_TERMINAL_ID } from './data/sessions';
import {
  createShowcaseToolBursts,
  SHOWCASE_ARCHITECTURE_LINK,
  SHOWCASE_ARTIFACTS_CONTENT,
  SHOWCASE_COMMANDS_NARRATION,
  SHOWCASE_EMBEDDED_RESOURCE,
  SHOWCASE_ERROR_EVENT,
  SHOWCASE_EXPLORE_NARRATION,
  SHOWCASE_FILES_NARRATION,
  SHOWCASE_IMAGE,
  SHOWCASE_INTRO_CONTENT,
  SHOWCASE_PERMISSION_DENIED_CONTENT,
  SHOWCASE_PERMISSION_GRANTED_CONTENT,
  SHOWCASE_PERMISSIONS,
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
  /** The pending snapshot the ask was raised for; the response re-emits it resolved. */
  toolCall: ToolCall;
}

export class DevMockHost {
  private readonly sessions = new Map<SessionId, MockSession>();
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();
  private providers: ProvidersConfig = {};
  private readonly permissions = new Map<string, PendingPermission>();
  private history: AgentHistorySession[] = [];
  private readonly terminals = new Set<string>();
  private readonly scripts = new Map<string, Map<string, WorkspaceScript>>();
  private sessionSeq = 0;
  private messageSeq = 0;
  private workspaceSeq = 0;
  private terminalSeq = 0;

  constructor(private readonly transport: Transport) {}

  private scriptsFor(cwd: string): Map<string, WorkspaceScript> {
    let scripts = this.scripts.get(cwd);
    if (!scripts) {
      scripts = new Map(mockScriptDeclarations().map((script) => [script.scriptName, script]));
      this.scripts.set(cwd, scripts);
    }
    return scripts;
  }

  start(): void {
    void this.transport.connect();
    this.transport.onMessage((msg) => {
      void this.handle(msg);
    });
    const now = Date.now();
    for (const { ageMs, ...seed } of SEED_SESSIONS) {
      const createdAt = now - ageMs;
      this.addSession({ ...seed, createdAt, updatedAt: createdAt });
      this.touchWorkspace(seed.cwd, createdAt);
    }
    this.history = SEED_HISTORY.map(({ ageMs, ...entry }) => ({
      ...entry,
      createdAt: now - ageMs,
      updatedAt: now - ageMs,
    }));
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
          status: gitFixtureFor(p.cwd).status,
        });
        break;
      case 'git.pr_status.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'git.pr_status.get.result',
          replyTo: p.clientReqId,
          prStatus: gitFixtureFor(p.cwd).prStatus,
        });
        break;
      case 'git.diff.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'git.diff.get.result',
          replyTo: p.clientReqId,
          diff: gitFixtureFor(p.cwd).diff,
        });
        break;
      case 'file.read': {
        await wait(CONTROL_LATENCY_MS);
        const file = mockFileFixture(p.cwd, p.path);
        if (file) this.send({ kind: 'file.read.result', replyTo: p.clientReqId, file });
        else this.sendFailure(p.clientReqId, `Mock host has no fixture for ${p.path}`);
        break;
      }
      case 'script.list': {
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'script.listed',
          replyTo: p.clientReqId,
          scripts: [...this.scriptsFor(p.cwd).values()],
        });
        break;
      }
      case 'script.start': {
        await wait(CONTROL_LATENCY_MS);
        const script = this.scriptsFor(p.cwd).get(p.scriptName);
        if (!script || script.lifecycle === 'running') {
          this.sendFailure(p.clientReqId, `Cannot start mock script: ${p.scriptName}`);
          break;
        }
        this.sendSuccess(p.clientReqId);
        script.lifecycle = 'running';
        script.terminalId = SHOWCASE_TERMINAL_ID;
        this.send({ kind: 'script.status', cwd: p.cwd, script: { ...script } });
        if (script.type === 'service') {
          await wait(CONTROL_LATENCY_MS);
          script.health = 'healthy';
          this.send({ kind: 'script.status', cwd: p.cwd, script: { ...script } });
        }
        break;
      }
      case 'script.stop': {
        await wait(CONTROL_LATENCY_MS);
        const script = this.scriptsFor(p.cwd).get(p.scriptName);
        if (script?.lifecycle !== 'running') {
          this.sendFailure(p.clientReqId, `Mock script not running: ${p.scriptName}`);
          break;
        }
        this.sendSuccess(p.clientReqId);
        script.lifecycle = 'stopped';
        script.health = 'unknown';
        script.exitCode = 0;
        this.send({ kind: 'script.status', cwd: p.cwd, script: { ...script } });
        break;
      }
      case 'session.import':
        await wait(CONTROL_LATENCY_MS);
        this.importSession(p.clientReqId, p.agentKind, p.historyId);
        break;
      case 'history.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'history.listed',
          replyTo: p.clientReqId,
          result: { sessions: this.listHistory(p.agentKind, p.opts?.cwd) },
        });
        break;
      case 'history.read':
      case 'history.resume':
        // Fail loudly for unmocked surfaces so correlated SDK calls reject instead of hanging forever.
        this.sendFailure(p.clientReqId, 'Dev mock host does not support history yet.');
        break;
      case 'terminal.open':
        await wait(CONTROL_LATENCY_MS);
        this.openTerminal(p.clientReqId, p.opts.cwd);
        break;
      case 'terminal.input':
        // Echo PTY: no shell behind it, keystrokes come straight back; Enter draws a fresh prompt.
        if (this.terminals.has(p.terminalId)) {
          this.send({
            kind: 'terminal.output',
            terminalId: p.terminalId,
            data: p.data.replaceAll('\r', '\r\n$ '),
          });
        }
        break;
      case 'terminal.close':
        if (this.terminals.delete(p.terminalId)) {
          this.send({ kind: 'terminal.exit', terminalId: p.terminalId, exitCode: 0 });
        }
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
      origin?: SessionInfo['origin'];
    },
  ): MockSession {
    const { origin, ...rest } = init;
    const session: MockSession = {
      ...rest,
      sessionId: this.nextSessionId(),
      origin: origin ?? { type: 'created' },
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
    const now = Date.now();
    const session = this.addSession({
      kind,
      cwd,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      model,
    });
    // Parity with the engine: starting a session registers/freshens its directory's workspace.
    this.touchWorkspace(cwd, now);
    const { sessionId } = session;
    this.emit(sessionId, { type: 'status', status: 'starting' });
    this.emit(sessionId, { type: 'current-mode-update', currentModeId: 'mock' });
    this.emit(sessionId, { type: 'status', status: 'idle' });
    this.send({ kind: 'session.started', replyTo, sessionId });
  }

  private listHistory(agentKind: AgentKind, cwd: string | undefined): AgentHistorySession[] {
    const cwdKey = cwd === undefined ? null : normalizeCwdKey(cwd);
    return this.history.filter(
      (entry) =>
        entry.kind === agentKind &&
        (cwdKey === null || (entry.cwd !== undefined && normalizeCwdKey(entry.cwd) === cwdKey)),
    );
  }

  /** Mint a cold (stopped, resumable) session from a canned history entry, like the engine's import. */
  private importSession(replyTo: string, agentKind: AgentKind, historyId: AgentHistoryId): void {
    const entry = this.history.find(
      (item) => item.kind === agentKind && item.historyId === historyId,
    );
    if (!entry) {
      this.sendFailure(replyTo, `Unknown history session: ${historyId}`);
      return;
    }
    const now = Date.now();
    const origin = { type: 'imported', historyId, importedAt: now } as const;
    const session = this.addSession({
      kind: entry.kind,
      cwd: entry.cwd ?? '/mock/imported',
      title: entry.title,
      status: 'stopped',
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
      origin,
    });
    this.send({
      kind: 'session.imported',
      replyTo,
      record: {
        sessionId: session.sessionId,
        kind: session.kind,
        cwd: session.cwd,
        title: session.title,
        origin,
        createdAt: session.createdAt,
        updatedAt: now,
        runs: [],
      },
    });
  }

  private openTerminal(replyTo: string, cwd: string | undefined): void {
    this.terminalSeq += 1;
    const terminalId = `mock-term-${Date.now().toString(36)}-${this.terminalSeq.toString(36)}`;
    this.terminals.add(terminalId);
    this.send({ kind: 'terminal.opened', replyTo, terminalId });
    this.send({
      kind: 'terminal.output',
      terminalId,
      data: `mock echo terminal — no shell attached (cwd: ${cwd ?? '/'})\r\n$ `,
    });
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
    this.drainSessionPermissions(sessionId, { outcome: 'cancelled' });
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
        this.drainSessionPermissions(sessionId, { outcome: 'cancelled' });
        session.status = 'idle';
        this.emit(sessionId, { type: 'stop', stopReason: 'cancelled' });
        this.emit(sessionId, { type: 'status', status: 'idle' });
        this.sendSuccess(replyTo);
        break;
      case 'set-model':
        session.model = input.model;
        this.sendSuccess(replyTo);
        break;
      case 'set-effort':
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
      // eslint-disable-next-line no-await-in-loop -- word-by-word streaming: chunks are paced sequentially by design.
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
    const bursts = createShowcaseToolBursts(terminalId);
    const toolEvents = (toolCalls: readonly ToolCall[]): AgentEvent[] =>
      toolCalls.map((toolCall) => ({ type: 'tool-call', toolCall }));

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
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-artifacts'),
        content: SHOWCASE_ARTIFACTS_CONTENT,
      },
      ...toolEvents(bursts.explore),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-explore-note'),
        content: SHOWCASE_EXPLORE_NARRATION,
      },
      ...toolEvents(bursts.files),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-files-note'),
        content: SHOWCASE_FILES_NARRATION,
      },
      ...toolEvents(bursts.commands),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-commands-note'),
        content: SHOWCASE_COMMANDS_NARRATION,
      },
      ...toolEvents(bursts.wrapUp),
    ];

    for (const event of script) {
      // eslint-disable-next-line no-await-in-loop -- the showcase script emits step by step on purpose.
      if (!(await waitForShowcaseStep(session, epoch))) return false;
      this.emit(session.sessionId, event);
    }
    if (!(await waitForShowcaseStep(session, epoch))) return false;
    this.send({ kind: 'terminal.output', terminalId, data: SHOWCASE_TERMINAL_START_OUTPUT });
    for (const permission of SHOWCASE_PERMISSIONS) {
      this.permissions.set(permission.requestId, {
        sessionId: session.sessionId,
        toolCall: permission.toolCall,
      });
      // eslint-disable-next-line no-await-in-loop -- the showcase script emits step by step on purpose.
      const emitted = await this.emitShowcaseEvent(session, epoch, {
        type: 'permission-request',
        requestId: permission.requestId,
        toolCall: permission.toolCall,
        options: permission.options,
      });
      if (!emitted) return false;
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
      // eslint-disable-next-line no-await-in-loop -- word-by-word streaming: chunks are paced sequentially by design.
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
    // A real agent turn stays in flight while a permission ask awaits its reply. Poll instead of
    // coordinating with respondPermission so the turn lifecycle stays in this one method.
    while (this.hasPendingPermission(session.sessionId)) {
      // eslint-disable-next-line no-await-in-loop -- deliberate poll while awaiting the permission reply.
      await wait(200);
      if (!isRunningTurn(session, epoch)) return;
    }
    this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
  }

  private hasPendingPermission(sessionId: SessionId): boolean {
    for (const pending of this.permissions.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    return false;
  }

  private drainSessionPermissions(sessionId: SessionId, outcome: PermissionOutcome): void {
    for (const [requestId, pending] of this.permissions) {
      if (pending.sessionId !== sessionId) continue;
      this.permissions.delete(requestId);
      this.emitToolSnapshot(sessionId, {
        ...pending.toolCall,
        status: 'failed',
        rawOutput: { outcome },
      });
    }
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
      ...pending.toolCall,
      status: allowed ? 'completed' : 'failed',
      content: [
        ...pending.toolCall.content,
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
    updatedAt: session.updatedAt,
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

const PATH_SEPARATORS_RE = /[/\\]+/;

function lastPathSegment(cwd: string): string {
  return cwd.split(PATH_SEPARATORS_RE).findLast((part) => part.length > 0) ?? cwd;
}
