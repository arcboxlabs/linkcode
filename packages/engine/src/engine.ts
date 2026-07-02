import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { createAdapter } from '@linkcode/agent-adapter';
import type {
  AgentHistoryId,
  ContentBlock,
  SessionId,
  SessionInfo,
  SessionRecord,
  WireMessage,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { GitService } from './git/git-service';
import { HistoryService } from './history-service';
import type { ProviderConfigStore } from './provider-config';
import { applyProviderDefaults, InMemoryProviderConfigStore } from './provider-config';
import type { PtyBackend } from './pty-backend';
import type { SessionStore } from './session-store';
import { InMemorySessionStore } from './session-store';
import { TerminalService } from './terminal-service';
import { WorkspaceRegistry } from './workspace-registry';
import type { WorkspaceStore } from './workspace-store';
import { InMemoryWorkspaceStore } from './workspace-store';

interface Session {
  adapter: AgentAdapter;
  unsub: Unsubscribe;
  status: SessionInfo['status'];
}

/**
 * Engine: the local core engine — the "host" that runs the agents (PLAN §4.1).
 * Manages multiple agent sessions, pushing each adapter's normalized events down to clients over the
 * transport and routing input back up to the matching adapter.
 *
 * The transport is decoupled from the carrier: a direct local connection, a fan-out Hub serving many
 * clients, or a tunnel through the Server all use the same Engine (PLAN §2.6). Because the daemon broadcasts
 * events to every attached client, request/response control messages are correlated by id: `session.start`
 * carries a `clientReqId` that the matching `session.started` echoes back as `replyTo`.
 */
export class Engine {
  private readonly sessions = new Map<SessionId, Session>();
  /** Persisted session identities (live and cold), loaded from the store and kept in sync. */
  private readonly records = new Map<SessionId, SessionRecord>();
  private readonly history: HistoryService;
  private readonly terminals?: TerminalService;
  private readonly workspaces: WorkspaceRegistry;
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    private readonly factory: AdapterFactory = createAdapter,
    private readonly providerStore: ProviderConfigStore = new InMemoryProviderConfigStore(),
    ptyBackend?: PtyBackend,
    private readonly sessionStore: SessionStore = new InMemorySessionStore(),
    private readonly git: GitService = new GitService(),
    workspaceStore: WorkspaceStore = new InMemoryWorkspaceStore(),
  ) {
    this.history = new HistoryService(factory);
    this.terminals = ptyBackend
      ? new TerminalService(ptyBackend, transport, (id) => this.sessions.has(id))
      : undefined;
    this.workspaces = new WorkspaceRegistry(workspaceStore);
  }

  async start(): Promise<void> {
    for (const record of await this.sessionStore.load()) {
      this.records.set(record.sessionId, record);
    }
    await this.workspaces.start();
    await this.transport.connect();
    this.transport.onMessage((msg) => {
      // TODO: Error reporting (pending confirmation of the Server realtime / perm model, PLAN §10.7).
      this.handle(msg).catch(noop);
    });
  }

  /**
   * Ensure the daemon-owned chat workspace exists at `cwd` — see
   * {@link WorkspaceRegistry.ensureChatWorkspace}. Called once by the daemon at startup, before any
   * client can connect.
   */
  ensureChatWorkspace(cwd: string): Promise<WorkspaceRecord> {
    return this.workspaces.ensureChatWorkspace(cwd);
  }

  private async handle(msg: WireMessage): Promise<void> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.start': {
        const opts = applyProviderDefaults(p.opts, this.providerStore.get());
        await this.tryReply(p.clientReqId, async () => {
          const now = Date.now();
          const record: SessionRecord = {
            sessionId: this.nextSessionId(),
            kind: opts.kind,
            cwd: opts.cwd,
            origin: { type: 'created' },
            createdAt: now,
            updatedAt: now,
            runs: [{ startedAt: now }],
          };
          await this.startLiveSession(p.clientReqId, record, (adapter) => adapter.start(opts));
          if (opts.cwd) this.workspaces.touch(opts.cwd);
        });
        break;
      }
      case 'agent.input': {
        await this.tryReply(p.clientReqId, async () => {
          const session = nullthrow(
            this.sessions.get(p.sessionId),
            `Unknown session: ${p.sessionId}`,
          );
          // Echo the user's prompt into the broadcast stream so every attached client (and any
          // reconnect) sees the full conversation; ordered before the adapter's reply events.
          if (p.input.type === 'prompt') {
            this.transport.send(
              createWireMessage({
                kind: 'agent.event',
                sessionId: p.sessionId,
                event: { type: 'user-message', content: p.input.content },
              }),
            );
            this.maybeSetTitle(p.sessionId, p.input.content);
          }
          await session.adapter.send(p.input);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.stop': {
        await this.tryReply(p.clientReqId, async () => {
          const session = nullthrow(
            this.sessions.get(p.sessionId),
            `Unknown session: ${p.sessionId}`,
          );
          session.unsub();
          await session.adapter.stop();
          this.sessions.delete(p.sessionId);
          this.terminals?.killBySession(p.sessionId);
          this.sealCurrentRun(p.sessionId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.list': {
        const sessions = Array.from(this.records.values(), (record) => this.toSessionInfo(record));
        this.transport.send(
          createWireMessage({ kind: 'session.listed', replyTo: p.clientReqId, sessions }),
        );
        break;
      }
      case 'session.resume': {
        await this.tryReply(p.clientReqId, async () => {
          if (this.sessions.has(p.sessionId)) {
            throw new Error(`Session is already running: ${p.sessionId}`);
          }
          const record = nullthrow(
            this.records.get(p.sessionId),
            `Unknown session: ${p.sessionId}`,
          );
          // A never-prompted session has no provider transcript to resume from (the adapter only
          // mints one on the first prompt); waking it is a fresh start under the same Link Code id.
          const historyId = latestHistoryId(record);
          const startOpts = applyProviderDefaults(
            { kind: record.kind, cwd: record.cwd },
            this.providerStore.get(),
          );
          record.runs.push({ historyId, startedAt: Date.now() });
          await this.startLiveSession(p.clientReqId, record, (adapter) =>
            historyId === undefined
              ? adapter.start(startOpts)
              : this.history.resume(adapter, historyId, startOpts),
          );
        });
        break;
      }
      case 'session.import': {
        await this.tryReply(p.clientReqId, async () => {
          // Read one event only: the summary (title/cwd/createdAt) is what the record needs.
          const { session } = await this.history.read(p.agentKind, {
            historyId: p.historyId,
            limit: 1,
          });
          const now = Date.now();
          const record: SessionRecord = {
            sessionId: this.nextSessionId(),
            kind: p.agentKind,
            cwd: session.cwd ?? '',
            title: session.title,
            origin: { type: 'imported', historyId: p.historyId, importedAt: now },
            createdAt: session.createdAt ?? now,
            updatedAt: now,
            runs: [],
          };
          this.records.set(record.sessionId, record);
          await this.sessionStore.save(record);
          this.transport.send(
            createWireMessage({ kind: 'session.imported', replyTo: p.clientReqId, record }),
          );
        });
        break;
      }
      case 'history.list': {
        await this.tryReply(p.clientReqId, async () => {
          const result = await this.history.list(p.agentKind, p.opts);
          this.transport.send(
            createWireMessage({ kind: 'history.listed', replyTo: p.clientReqId, result }),
          );
        });
        break;
      }
      case 'history.read': {
        await this.tryReply(p.clientReqId, async () => {
          const result = await this.history.read(p.agentKind, p.opts);
          this.transport.send(
            createWireMessage({ kind: 'history.read.result', replyTo: p.clientReqId, result }),
          );
        });
        break;
      }
      case 'history.resume': {
        const startOpts = applyProviderDefaults(
          { ...p.startOpts, kind: p.agentKind },
          this.providerStore.get(),
        );
        await this.tryReply(p.clientReqId, async () => {
          const now = Date.now();
          const record: SessionRecord = {
            sessionId: this.nextSessionId(),
            kind: p.agentKind,
            cwd: startOpts.cwd,
            origin: { type: 'imported', historyId: p.historyId, importedAt: now },
            createdAt: now,
            updatedAt: now,
            runs: [{ historyId: p.historyId, startedAt: now }],
          };
          await this.startLiveSession(p.clientReqId, record, (adapter) =>
            this.history.resume(adapter, p.historyId, startOpts),
          );
          if (startOpts.cwd) this.workspaces.touch(startOpts.cwd);
        });
        break;
      }
      case 'config.get': {
        this.transport.send(
          createWireMessage({
            kind: 'config.get.result',
            replyTo: p.clientReqId,
            providers: this.providerStore.get(),
          }),
        );
        break;
      }
      case 'config.set': {
        await this.tryReply(p.clientReqId, async () => {
          await this.providerStore.set(p.providers);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'workspace.list': {
        this.transport.send(
          createWireMessage({
            kind: 'workspace.listed',
            replyTo: p.clientReqId,
            workspaces: this.workspaces.list(),
          }),
        );
        break;
      }
      case 'workspace.register': {
        await this.tryReply(p.clientReqId, async () => {
          const record = await this.workspaces.register({
            cwd: p.cwd,
            name: p.name,
            kind: p.workspaceKind,
          });
          this.transport.send(
            createWireMessage({ kind: 'workspace.registered', replyTo: p.clientReqId, record }),
          );
        });
        break;
      }
      case 'workspace.update': {
        await this.tryReply(p.clientReqId, () => {
          this.workspaces.update(p.workspaceId, p.name);
          this.sendSuccess(p.clientReqId);
          return Promise.resolve();
        });
        break;
      }
      case 'workspace.archive': {
        await this.tryReply(p.clientReqId, () => {
          this.workspaces.archive(p.workspaceId);
          this.sendSuccess(p.clientReqId);
          return Promise.resolve();
        });
        break;
      }
      case 'git.status.get': {
        await this.tryReply(p.clientReqId, async () => {
          const status = await this.git.getStatus(p.cwd);
          this.transport.send(
            createWireMessage({ kind: 'git.status.get.result', replyTo: p.clientReqId, status }),
          );
        });
        break;
      }
      case 'git.pr_status.get': {
        await this.tryReply(p.clientReqId, async () => {
          const prStatus = await this.git.getPullRequestStatus(p.cwd);
          this.transport.send(
            createWireMessage({
              kind: 'git.pr_status.get.result',
              replyTo: p.clientReqId,
              prStatus,
            }),
          );
        });
        break;
      }
      case 'git.diff.get': {
        await this.tryReply(p.clientReqId, async () => {
          const diff = await this.git.getDiff(p.cwd, p.mode);
          this.transport.send(
            createWireMessage({ kind: 'git.diff.get.result', replyTo: p.clientReqId, diff }),
          );
        });
        break;
      }
      case 'session.attach':
      case 'session.detach': {
        // Multi-device attach is implicit: events are broadcast to all clients. These are accepted as
        // no-ops for now; a future enhancement can replay buffered state to a freshly-attached client.
        break;
      }
      case 'terminal.open': {
        const terminals = this.terminals;
        if (!terminals) {
          this.sendFailure(p.clientReqId, new Error('Terminals are not supported on this host'));
          break;
        }
        await this.tryReply(p.clientReqId, () => terminals.open(p.clientReqId, p.opts));
        break;
      }
      case 'terminal.input': {
        this.terminals?.input(p.terminalId, p.data);
        break;
      }
      case 'terminal.resize': {
        this.terminals?.resize(p.terminalId, p.cols, p.rows);
        break;
      }
      case 'terminal.close': {
        this.terminals?.close(p.terminalId);
        break;
      }
      case 'ping': {
        this.transport.send(createWireMessage({ kind: 'pong' }));
        break;
      }
      // Downstream-only payloads are ignored here.
      default:
        break;
    }
  }

  /** Reap host-owned terminals once no client remains to read them — see {@link TerminalService.killHostTerminals}. */
  reapHostTerminals(): void {
    this.terminals?.killHostTerminals();
  }

  async stop(): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values(), async (session) => {
        session.unsub();
        await session.adapter.stop();
      }),
    );
    this.sessions.clear();
    this.terminals?.closeAll();
    this.transport.close();
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
  }

  /**
   * Bind a (new or resumed) record to a live adapter run. The record — already carrying its
   * current run as the last entry of `runs` — becomes the persisted identity; the adapter's
   * `session-ref` event later backfills that run's provider-local id.
   */
  private async startLiveSession(
    replyTo: string,
    record: SessionRecord,
    startAdapter: (adapter: AgentAdapter) => Promise<void>,
  ): Promise<void> {
    const sessionId = record.sessionId;
    const adapter = this.factory(record.kind);
    const session: Session = { adapter, unsub: noop, status: 'starting' };
    session.unsub = adapter.onEvent((event) => {
      if (event.type === 'status') {
        session.status = event.status;
        if (event.status === 'stopped') this.sealCurrentRun(sessionId);
      } else if (event.type === 'session-ref') {
        this.bindSessionRef(sessionId, event.historyId);
      }
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    });
    this.sessions.set(sessionId, session);
    this.records.set(sessionId, record);
    this.persistRecord(record);
    try {
      await startAdapter(adapter);
    } catch (err) {
      session.unsub();
      this.sessions.delete(sessionId);
      this.sealCurrentRun(sessionId);
      await adapter.stop().catch(noop);
      throw err;
    }
    this.transport.send(createWireMessage({ kind: 'session.started', replyTo, sessionId }));
  }

  private toSessionInfo(record: SessionRecord): SessionInfo {
    return {
      sessionId: record.sessionId,
      kind: record.kind,
      cwd: record.cwd,
      status: this.sessions.get(record.sessionId)?.status ?? 'stopped',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      title: record.title,
      origin: record.origin,
      historyId: latestHistoryId(record),
    };
  }

  /** Record the provider-local id of the session's current (last) run. */
  private bindSessionRef(sessionId: SessionId, historyId: AgentHistoryId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.historyId === historyId) return;
    run.historyId = historyId;
    this.persistRecord(record);
  }

  private sealCurrentRun(sessionId: SessionId): void {
    const record = this.records.get(sessionId);
    const run = record?.runs.at(-1);
    if (!record || !run || run.endedAt !== undefined) return;
    run.endedAt = Date.now();
    this.persistRecord(record);
  }

  private maybeSetTitle(sessionId: SessionId, content: ContentBlock[]): void {
    const record = this.records.get(sessionId);
    if (!record || record.title !== undefined) return;
    const title = titleFromContent(content);
    if (title === undefined) return;
    record.title = title;
    this.persistRecord(record);
  }

  private persistRecord(record: SessionRecord): void {
    record.updatedAt = Date.now();
    // TODO: Error reporting (same stance as handle(): pending the Server realtime / perm model).
    void this.sessionStore.save(record).catch(noop);
  }

  private async tryReply(replyTo: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.sendFailure(replyTo, err);
    }
  }

  private sendFailure(replyTo: string, err: unknown): void {
    const message = extractErrorMessage(err) ?? 'Unknown error';
    this.transport.send(createWireMessage({ kind: 'request.failed', replyTo, message }));
  }

  private sendSuccess(replyTo: string): void {
    this.transport.send(createWireMessage({ kind: 'request.succeeded', replyTo }));
  }
}

/** The provider-local id to resume from: the latest run that has one, else the imported origin. */
function latestHistoryId(record: SessionRecord): AgentHistoryId | undefined {
  for (let index = record.runs.length - 1; index >= 0; index -= 1) {
    const historyId = record.runs[index].historyId;
    if (historyId !== undefined) return historyId;
  }
  return record.origin.type === 'imported' ? record.origin.historyId : undefined;
}

const SESSION_TITLE_MAX_LENGTH = 80;

function titleFromContent(content: ContentBlock[]): string | undefined {
  for (const block of content) {
    if (block.type !== 'text') continue;
    const text = block.text.trim().replaceAll(/\s+/g, ' ');
    if (text.length === 0) continue;
    return text.length > SESSION_TITLE_MAX_LENGTH
      ? `${text.slice(0, SESSION_TITLE_MAX_LENGTH - 1)}…`
      : text;
  }
  return undefined;
}
