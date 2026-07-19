import type {
  Accounts,
  AgentEvent,
  AgentHistoryId,
  AgentHistorySession,
  AgentInput,
  AgentKind,
  AgentRuntimes,
  ContentBlock,
  ManagedAssetId,
  ManagedAssetStatus,
  MessageId,
  PermissionOutcome,
  ProvidersConfig,
  QuestionOutcome,
  SessionId,
  SessionInfo,
  SessionStatus,
  TerminalMetadata,
  TerminalReplayEvent,
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
import { MOCK_WORKSPACE_FILES, mockFileFixture } from './data/files';
import { gitFixtureFor } from './data/git';
import { SEED_HISTORY } from './data/history';
import { SEED_MODEL_CATALOGS } from './data/models';
import {
  CHUNK_LATENCY_MS,
  CONTROL_LATENCY_MS,
  FAIL_PROMPT,
  MOCK_REPLY,
  MOCK_USAGE_REPORT,
  WORD_CHUNK_PATTERN,
} from './data/prompt';
import { mockScriptDeclarations } from './data/scripts';
import { SEED_SESSIONS, SHOWCASE_TERMINAL_ID } from './data/sessions';
import {
  createShowcaseToolBursts,
  SHOWCASE_ARCHITECTURE_LINK,
  SHOWCASE_ARTIFACTS_CONTENT,
  SHOWCASE_COMMANDS_NARRATION,
  SHOWCASE_COMPACTION_HOLD_MS,
  SHOWCASE_COMPACTION_ID,
  SHOWCASE_COMPACTION_POST_TOKENS,
  SHOWCASE_COMPACTION_PRE_TOKENS,
  SHOWCASE_COMPACTION_SUMMARY,
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
  SHOWCASE_QUESTION,
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

/** Pace of the mock download's staged `asset.progress` broadcasts. */
const ASSET_PROGRESS_LATENCY_MS = 400;

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

interface MockTerminal {
  metadata: TerminalMetadata;
  seq: number;
  replay: TerminalReplayEvent[];
  attachments: Map<string, string>;
}

function createMockTerminal(
  terminalId: string,
  opts: {
    managed: boolean;
    cols?: number;
    rows?: number;
    cwd?: string;
    shell?: string;
    sessionId?: SessionId;
  },
): MockTerminal {
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  return {
    metadata: {
      terminalId,
      cols,
      rows,
      cwd: opts.cwd,
      shell: opts.shell,
      sessionId: opts.sessionId,
      managed: opts.managed,
      createdAt: Date.now(),
      controllerAttachmentId: null,
    },
    seq: 1,
    replay: [{ type: 'resize', seq: 1, cols, rows }],
    attachments: new Map(),
  };
}

interface PendingQuestion {
  sessionId: SessionId;
  /** The pending snapshot the ask was raised for; the response re-emits it resolved. */
  toolCall: ToolCall;
}

export class DevMockHost {
  private readonly sessions = new Map<SessionId, MockSession>();
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();
  private providers: ProvidersConfig = {};
  private accounts: Accounts = [];
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly questions = new Map<string, PendingQuestion>();
  private history: AgentHistorySession[] = [];
  private readonly terminals = new Map<string, MockTerminal>();
  private readonly scripts = new Map<string, Map<string, WorkspaceScript>>();
  private sessionSeq = 0;
  private messageSeq = 0;
  private workspaceSeq = 0;
  private terminalSeq = 0;
  /** Assets a mock `asset.ensure` has "installed"; list/runtime replies reflect it afterwards. */
  private readonly installedAssets = new Set<ManagedAssetId>();

  constructor(private readonly transport: Transport) {
    this.terminals.set(
      SHOWCASE_TERMINAL_ID,
      createMockTerminal(SHOWCASE_TERMINAL_ID, { managed: true }),
    );
  }

  /**
   * Onboarding fixtures (CODE-112), one kind per state: claude-code missing (downloadable), codex
   * out-of-range (unverified-continue + paired-download), pi builtin, opencode absent (unevaluated).
   */
  private agentRuntimes(): AgentRuntimes {
    return {
      'claude-code': this.installedAssets.has('agent:claude-code')
        ? {
            status: 'available',
            source: 'managed',
            version: '2.1.179',
            path: '/mock/assets/agent/claude-code/0.3.179/claude',
          }
        : { status: 'missing' },
      codex: this.installedAssets.has('agent:codex')
        ? {
            status: 'available',
            source: 'managed',
            version: '0.140.0',
            path: '/mock/assets/agent/codex/0.140.0/codex',
          }
        : { status: 'out-of-range', source: 'detected', version: '0.99.0' },
      pi: { status: 'available', source: 'builtin' },
    };
  }

  private assetStatuses(): ManagedAssetStatus[] {
    return (
      [
        { id: 'agent:claude-code', wantedVersion: '0.3.179' },
        { id: 'agent:codex', wantedVersion: '0.140.0' },
        { id: 'tool:tectonic', wantedVersion: '0.16.9' },
      ] as const
    ).map(({ id, wantedVersion }) => ({
      id,
      wantedVersion,
      installed: this.installedAssets.has(id)
        ? {
            id,
            version: wantedVersion,
            path: `/mock/assets/${id.replace(':', '/')}/${wantedVersion}/bin`,
          }
        : undefined,
    }));
  }

  /** Staged download: throttled progress → settled → correlated reply → runtime re-probe push. */
  private async ensureAsset(clientReqId: string, id: ManagedAssetId): Promise<void> {
    const totalBytes = 66 * 1_048_576;
    for (const fraction of [0.04, 0.19, 0.42, 0.68, 0.91]) {
      this.send({
        kind: 'asset.progress',
        id,
        receivedBytes: Math.round(totalBytes * fraction),
        totalBytes,
      });
      // eslint-disable-next-line no-await-in-loop -- staged progress is deliberately sequential
      await wait(ASSET_PROGRESS_LATENCY_MS);
    }
    this.installedAssets.add(id);
    const status = this.assetStatuses().find((candidate) => candidate.id === id) ?? {
      id,
      wantedVersion: '0.0.0',
    };
    this.send({ kind: 'asset.settled', id, installed: status.installed });
    this.send({ kind: 'asset.ensured', replyTo: clientReqId, status });
    this.send({ kind: 'agent-runtime.changed', runtimes: this.agentRuntimes() });
  }

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
        this.send({
          kind: 'config.get.result',
          replyTo: p.clientReqId,
          providers: this.providers,
          accounts: this.accounts,
        });
        break;
      case 'agent-runtime.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'agent-runtime.listed',
          replyTo: p.clientReqId,
          runtimes: this.agentRuntimes(),
        });
        break;
      case 'asset.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'asset.listed',
          replyTo: p.clientReqId,
          assets: this.assetStatuses(),
        });
        break;
      case 'asset.ensure':
        await this.ensureAsset(p.clientReqId, p.id);
        break;
      case 'config.set':
        await wait(CONTROL_LATENCY_MS);
        if (p.providers !== undefined) this.providers = structuredClone(p.providers);
        if (p.accounts !== undefined) this.accounts = structuredClone(p.accounts);
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
      case 'file.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'file.list.result',
          replyTo: p.clientReqId,
          files: [...MOCK_WORKSPACE_FILES],
        });
        break;
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
      case 'artifact.host': {
        await wait(CONTROL_LATENCY_MS);
        // No reverse proxy in mock mode: a renderer-local blob URL stands in for the
        // daemon's per-artifact origin (the desktop CSP allows frame-src blob:).
        const url = URL.createObjectURL(new Blob([p.content], { type: p.mimeType }));
        this.send({
          kind: 'artifact.hosted',
          replyTo: p.clientReqId,
          artifact: { hash: `mock-${this.messageSeq++}`, hostname: 'mock.localhost', url },
        });
        break;
      }
      case 'artifact.revoke': {
        this.sendSuccess(p.clientReqId);
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
      case 'terminal.list':
        this.send({
          kind: 'terminal.listed',
          replyTo: p.clientReqId,
          terminals: [...this.terminals.values()].map((terminal) => terminal.metadata),
        });
        break;
      case 'terminal.open':
        await wait(CONTROL_LATENCY_MS);
        this.openTerminal(p);
        break;
      case 'terminal.attach':
        this.attachTerminal(p);
        break;
      case 'terminal.detach':
        this.detachTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        break;
      case 'terminal.input': {
        // Echo PTY: no shell behind it, keystrokes come straight back; Enter draws a fresh prompt.
        const terminal = this.authorizedTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        if (terminal?.metadata.controllerAttachmentId === p.attachmentId) {
          this.writeTerminal(p.terminalId, p.data.replaceAll('\r', '\r\n$ '));
        }
        break;
      }
      case 'terminal.resize': {
        const terminal = this.authorizedTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        if (terminal?.metadata.controllerAttachmentId === p.attachmentId) {
          terminal.metadata = { ...terminal.metadata, cols: p.cols, rows: p.rows };
          this.resizeTerminal(p.terminalId, p.cols, p.rows);
        }
        break;
      }
      case 'terminal.close': {
        const terminal = this.authorizedTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        if (
          terminal?.metadata.controllerAttachmentId === p.attachmentId &&
          this.terminals.delete(p.terminalId)
        ) {
          this.send({ kind: 'terminal.exit', terminalId: p.terminalId, exitCode: 0 });
        }
        break;
      }
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
    const catalog = SEED_MODEL_CATALOGS[kind];
    if (catalog) {
      this.emit(sessionId, { type: 'available-models-update', models: catalog });
    }
    // Reflect a concrete model/effort like a real adapter, so the composer shows them not placeholders.
    this.emit(sessionId, {
      type: 'model-update',
      model: model ?? catalog?.[0]?.id ?? (kind === 'codex' ? 'gpt-5.5' : 'claude-opus-4-8'),
    });
    this.emit(sessionId, { type: 'effort-update', effort: 'high' });
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

  private openTerminal(p: Extract<WirePayload, { kind: 'terminal.open' }>): void {
    this.terminalSeq += 1;
    const terminalId = `mock-term-${Date.now().toString(36)}-${this.terminalSeq.toString(36)}`;
    const terminal = createMockTerminal(terminalId, { ...p.opts, managed: false });
    terminal.attachments.set(p.attachmentId, p.attachmentSecret);
    terminal.metadata = { ...terminal.metadata, controllerAttachmentId: p.attachmentId };
    this.terminals.set(terminalId, terminal);
    terminal.seq += 1;
    terminal.replay.push({
      type: 'write',
      seq: terminal.seq,
      data: `mock echo terminal — no shell attached (cwd: ${p.opts.cwd ?? '/'})\r\n$ `,
    });
    this.send({
      kind: 'terminal.opened',
      replyTo: p.clientReqId,
      terminal: terminal.metadata,
      replay: [...terminal.replay],
      cutoffSeq: terminal.seq,
      truncated: false,
    });
  }

  private attachTerminal(p: Extract<WirePayload, { kind: 'terminal.attach' }>): void {
    const terminal = this.terminals.get(p.terminalId);
    if (!terminal) {
      this.sendFailure(p.clientReqId, `Unknown terminal: ${p.terminalId}`);
      return;
    }
    const secret = terminal.attachments.get(p.attachmentId);
    if (secret !== undefined && secret !== p.attachmentSecret) {
      this.sendFailure(p.clientReqId, 'Invalid terminal attachment credentials');
      return;
    }
    if (p.mode === 'control' && terminal.metadata.managed) {
      this.sendFailure(p.clientReqId, 'Managed terminals are view-only');
      return;
    }
    terminal.attachments.set(p.attachmentId, p.attachmentSecret);
    if (p.mode === 'control') {
      terminal.metadata = {
        ...terminal.metadata,
        controllerAttachmentId: p.attachmentId,
      };
    }
    this.send({
      kind: 'terminal.attached',
      replyTo: p.clientReqId,
      terminal: terminal.metadata,
      replay: [...terminal.replay],
      cutoffSeq: terminal.seq,
      truncated: false,
    });
    if (p.mode === 'control') {
      this.send({
        kind: 'terminal.controller.changed',
        terminalId: p.terminalId,
        controllerAttachmentId: p.attachmentId,
      });
    }
  }

  private detachTerminal(terminalId: string, attachmentId: string, attachmentSecret: string): void {
    const terminal = this.authorizedTerminal(terminalId, attachmentId, attachmentSecret);
    if (!terminal) return;
    terminal.attachments.delete(attachmentId);
    if (terminal.metadata.controllerAttachmentId !== attachmentId) return;
    terminal.metadata = { ...terminal.metadata, controllerAttachmentId: null };
    this.send({
      kind: 'terminal.controller.changed',
      terminalId,
      controllerAttachmentId: null,
    });
  }

  private authorizedTerminal(
    terminalId: string,
    attachmentId: string,
    attachmentSecret: string,
  ): MockTerminal | undefined {
    const terminal = this.terminals.get(terminalId);
    return terminal?.attachments.get(attachmentId) === attachmentSecret ? terminal : undefined;
  }

  private writeTerminal(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.seq += 1;
    const event: TerminalReplayEvent = { type: 'write', seq: terminal.seq, data };
    terminal.replay.push(event);
    this.send({ kind: 'terminal.output', terminalId, seq: event.seq, data });
  }

  private resizeTerminal(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.seq += 1;
    const event: TerminalReplayEvent = { type: 'resize', seq: terminal.seq, cols, rows };
    terminal.replay.push(event);
    this.send({ kind: 'terminal.resized', terminalId, seq: event.seq, cols, rows });
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
    // Parity with the engine's replay-on-attach: a resumed session re-advertises its catalog.
    const catalog = SEED_MODEL_CATALOGS[session.kind];
    if (catalog) {
      this.emit(sessionId, { type: 'available-models-update', models: catalog });
    }
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
    this.drainSessionPrompts(sessionId);
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
        this.drainSessionPrompts(sessionId);
        session.status = 'idle';
        this.emit(sessionId, { type: 'stop', stopReason: 'cancelled' });
        this.emit(sessionId, { type: 'status', status: 'idle' });
        this.sendSuccess(replyTo);
        break;
      case 'set-model':
        session.model = input.model;
        this.emit(sessionId, { type: 'model-update', model: input.model });
        this.sendSuccess(replyTo);
        break;
      case 'set-effort':
        this.emit(sessionId, { type: 'effort-update', effort: input.effort });
        this.sendSuccess(replyTo);
        break;
      case 'set-mode':
        this.emit(sessionId, { type: 'current-mode-update', currentModeId: input.modeId });
        this.sendSuccess(replyTo);
        break;
      case 'permission-response':
        this.respondPermission(replyTo, sessionId, input.requestId, input.outcome);
        break;
      case 'command':
        // Parity with the real engine + claude-code /usage intercept (CODE-213): the engine
        // echoes the invocation text as a user-message before dispatch, the adapter brackets the
        // control request with status running→idle, and the reply is one structured usage-report
        // — no transcript text. Unknown commands mirror the engine's prevalidation reject (no echo).
        if (input.name === 'usage' || input.name === 'cost') {
          this.emit(sessionId, {
            type: 'user-message',
            content: [textBlock(`/${input.name}${input.arguments ? ` ${input.arguments}` : ''}`)],
          });
          this.emit(sessionId, { type: 'status', status: 'running' });
          this.emit(sessionId, { type: 'usage-report', report: MOCK_USAGE_REPORT });
          this.emit(sessionId, { type: 'status', status: 'idle' });
          this.sendSuccess(replyTo);
        } else {
          this.sendFailure(replyTo, 'Dev mock host only mocks the /usage command.');
        }
        break;
      case 'question-response':
        this.respondQuestion(replyTo, sessionId, input.requestId, input.outcome);
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
    this.writeTerminal(terminalId, SHOWCASE_TERMINAL_START_OUTPUT);
    this.questions.set(SHOWCASE_QUESTION.requestId, {
      sessionId: session.sessionId,
      toolCall: SHOWCASE_QUESTION.toolCall,
    });
    if (!(await this.emitShowcaseEvent(session, epoch, SHOWCASE_QUESTION))) return false;
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

    // One compaction across its whole lifecycle: the live "compacting…" row holds briefly, then
    // the completed re-emit merges over it (same compactionId) as the tokens+summary divider.
    this.emit(session.sessionId, {
      type: 'compaction',
      compactionId: SHOWCASE_COMPACTION_ID,
      status: 'in_progress',
      trigger: 'auto',
    });
    await wait(SHOWCASE_COMPACTION_HOLD_MS);
    if (!isRunningTurn(session, epoch)) return;
    this.emit(session.sessionId, {
      type: 'compaction',
      compactionId: SHOWCASE_COMPACTION_ID,
      status: 'completed',
      trigger: 'auto',
      preTokens: SHOWCASE_COMPACTION_PRE_TOKENS,
      postTokens: SHOWCASE_COMPACTION_POST_TOKENS,
      summary: SHOWCASE_COMPACTION_SUMMARY,
    });

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
    this.writeTerminal(terminalId, SHOWCASE_TERMINAL_EXIT_OUTPUT);
    this.emit(session.sessionId, {
      type: 'token-usage',
      usage: { inputTokens: 148, outputTokens: 96, totalCostUsd: 0 },
    });
    // A real agent turn stays in flight while a prompt awaits its reply. Poll instead of
    // coordinating with the responders so the turn lifecycle stays in this one method.
    while (this.hasPendingPrompt(session.sessionId)) {
      // eslint-disable-next-line no-await-in-loop -- deliberate poll while awaiting prompt replies.
      await wait(200);
      if (!isRunningTurn(session, epoch)) return;
    }
    this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
  }

  private hasPendingPrompt(sessionId: SessionId): boolean {
    for (const pending of this.questions.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    for (const pending of this.permissions.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    return false;
  }

  private drainSessionPrompts(sessionId: SessionId): void {
    for (const [requestId, pending] of this.permissions) {
      if (pending.sessionId !== sessionId) continue;
      this.permissions.delete(requestId);
      const outcome: PermissionOutcome = { outcome: 'cancelled' };
      this.emit(sessionId, {
        type: 'permission-resolved',
        requestId,
        outcome,
        source: 'session',
      });
      this.emitToolSnapshot(sessionId, {
        ...pending.toolCall,
        status: 'failed',
        rawOutput: { outcome },
      });
    }
    for (const [requestId, pending] of this.questions) {
      if (pending.sessionId !== sessionId) continue;
      this.questions.delete(requestId);
      const outcome: QuestionOutcome = { outcome: 'cancelled' };
      this.emit(sessionId, {
        type: 'question-resolved',
        requestId,
        outcome,
        source: 'session',
      });
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
    this.emit(sessionId, {
      type: 'permission-resolved',
      requestId,
      outcome,
      source: 'user',
    });
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

  private respondQuestion(
    replyTo: string,
    sessionId: SessionId,
    requestId: string,
    outcome: QuestionOutcome,
  ): void {
    const pending = this.questions.get(requestId);
    if (pending?.sessionId !== sessionId) {
      this.sendFailure(replyTo, `Unknown question request: ${requestId}`);
      return;
    }
    this.questions.delete(requestId);
    this.emit(sessionId, {
      type: 'question-resolved',
      requestId,
      outcome,
      source: 'user',
    });
    this.emitToolSnapshot(sessionId, {
      ...pending.toolCall,
      status: outcome.outcome === 'answered' ? 'completed' : 'failed',
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
