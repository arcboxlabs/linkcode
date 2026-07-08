import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { createAdapter } from '@linkcode/agent-adapter';
import type {
  AgentHistoryId,
  AgentRuntimes,
  ApprovalPolicyState,
  AssetInstallEvent,
  ContentBlock,
  InstalledAsset,
  ManagedAssetId,
  ManagedAssetStatus,
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
import { ArtifactHostService } from './artifacts/host-service';
import { readWorkspaceFile } from './file-service';
import { GitService } from './git/git-service';
import { HistoryService } from './history-service';
import type { ProviderConfigStore } from './provider-config';
import { applyProviderDefaults, InMemoryProviderConfigStore } from './provider-config';
import type { PtyBackend } from './pty-backend';
import { PreviewRouteRegistry } from './scripts/route-registry';
import { ScriptService } from './scripts/script-service';
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
  /** Latest advertised approval-policy state, replayed to freshly-attached clients — the event is
   * emitted at adapter start / on switches, which a client that (re)connects later has missed. */
  approvalPolicy?: ApprovalPolicyState;
}

/** Optional collaborators the daemon injects; each defaults to an in-memory/no-op implementation. */
export interface EngineDeps {
  factory?: AdapterFactory;
  sessionStore?: SessionStore;
  ptyBackend?: PtyBackend;
  providerStore?: ProviderConfigStore;
  git?: GitService;
  workspaceStore?: WorkspaceStore;
  /** Shared with the transport's reverse proxy; scripts need a PTY backend to run. */
  previewRoutes?: PreviewRouteRegistry;
  /** Boot-time probe result (`collectAgentRuntimes()`), served to clients on `agent-runtime.list`. */
  agentRuntimes?: AgentRuntimes;
  /** Managed-asset store, served on `asset.list` and driven by `asset.ensure`. */
  assets?: AssetService;
  /** Re-probe hook: refreshes the served runtime snapshot after a managed agent install lands. */
  collectAgentRuntimes?: () => Promise<AgentRuntimes>;
}

/** The slice of the daemon's AssetManager the engine consumes (live service, not a snapshot). */
export interface AssetService {
  statuses(): ManagedAssetStatus[];
  ensure(id: ManagedAssetId): Promise<InstalledAsset | undefined>;
  subscribe(listener: (event: AssetInstallEvent) => void): () => void;
}

/** Progress broadcasts are throttled per asset so a fast download can't flood the wire. */
const ASSET_PROGRESS_INTERVAL_MS = 150;

/**
 * Engine: the local core engine — the "host" that runs the agents
 * (docs/ARCHITECTURE.md#the-host-engine-adapters-abstraction).
 * Manages multiple agent sessions, pushing each adapter's normalized events down to clients over the
 * transport and routing input back up to the matching adapter.
 *
 * The transport is decoupled from the carrier: a direct local connection, a fan-out Hub serving many
 * clients, or a tunnel through the Server all use the same Engine (docs/ARCHITECTURE.md#core-principles). Because the daemon broadcasts
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
  private readonly factory: AdapterFactory;
  private readonly providerStore: ProviderConfigStore;
  private readonly sessionStore: SessionStore;
  private readonly git: GitService;
  private readonly scripts?: ScriptService;
  private readonly artifactHost: ArtifactHostService;
  /** Boot snapshot, replaced by {@link refreshAgentRuntimes} when a managed install lands. */
  private agentRuntimes: AgentRuntimes;
  private readonly assets?: AssetService;
  private readonly collectAgentRuntimes?: () => Promise<AgentRuntimes>;
  private readonly assetProgressSentAt = new Map<ManagedAssetId, number>();
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    deps: EngineDeps = {},
  ) {
    this.factory = deps.factory ?? createAdapter;
    this.providerStore = deps.providerStore ?? new InMemoryProviderConfigStore();
    this.sessionStore = deps.sessionStore ?? new InMemorySessionStore();
    this.git = deps.git ?? new GitService();
    this.history = new HistoryService(this.factory);
    this.terminals = deps.ptyBackend
      ? new TerminalService(deps.ptyBackend, transport, (id) => this.sessions.has(id))
      : undefined;
    this.workspaces = new WorkspaceRegistry(deps.workspaceStore ?? new InMemoryWorkspaceStore());
    const routes = deps.previewRoutes ?? new PreviewRouteRegistry();
    this.scripts = this.terminals
      ? new ScriptService(
          transport,
          this.terminals,
          routes,
          (cwd) => this.workspaces.findByCwd(cwd)?.name,
        )
      : undefined;
    this.artifactHost = new ArtifactHostService(routes);
    this.agentRuntimes = deps.agentRuntimes ?? {};
    this.assets = deps.assets;
    this.collectAgentRuntimes = deps.collectAgentRuntimes;
    // Lifetime = the daemon's: the engine is never disposed, so the subscription is never torn down.
    this.assets?.subscribe((event) => this.onAssetInstallEvent(event));
  }

  async start(): Promise<void> {
    for (const record of await this.sessionStore.load()) {
      this.records.set(record.sessionId, record);
    }
    await this.workspaces.start();
    await this.transport.connect();
    this.transport.onMessage((msg) => {
      // Per-request failures already reply over the wire via tryReply; this is the last-resort
      // backstop for anything that throws before or outside that path (e.g. a malformed payload).
      this.handle(msg).catch((err: unknown) => {
        console.error('Unhandled error while processing message:', err);
      });
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
        await this.tryReply(p.clientReqId, async () => {
          const opts = applyProviderDefaults(p.opts, this.providerStore.get());
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
          // Echo the user's prompt into the broadcast stream (and set the title) before awaiting
          // send: turn-blocking adapters (e.g. CodexAdapter, whose `send` waits for the whole
          // streamed turn to resolve) would otherwise delay the echo until after the assistant's
          // reply — or forever, if the turn hangs. A failed send still surfaces to the client, via
          // tryReply's `request.failed` reply, so this doesn't reintroduce a silent "ghost" message.
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
      case 'session.delete': {
        await this.tryReply(p.clientReqId, async () => {
          // Idempotent, unlike session.stop: the target is usually cold (the sidebar lists stopped
          // sessions too) and another client may have deleted it already. Provider-local history is
          // left untouched, so the conversation stays re-importable via session.import.
          const session = this.sessions.get(p.sessionId);
          if (session) {
            session.unsub();
            await session.adapter.stop();
            this.sessions.delete(p.sessionId);
            this.terminals?.killBySession(p.sessionId);
          }
          // Persisted delete first: if the store throws, the record stays listed (now cold) and the
          // client's retry still works — dropping it from memory first would desync the two.
          await this.sessionStore.delete(p.sessionId);
          this.records.delete(p.sessionId);
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
        await this.tryReply(p.clientReqId, async () => {
          const startOpts = applyProviderDefaults(
            { ...p.startOpts, kind: p.agentKind },
            this.providerStore.get(),
          );
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
      case 'agent-runtime.list': {
        this.transport.send(
          createWireMessage({
            kind: 'agent-runtime.listed',
            replyTo: p.clientReqId,
            runtimes: this.agentRuntimes,
          }),
        );
        break;
      }
      case 'asset.list': {
        this.transport.send(
          createWireMessage({
            kind: 'asset.listed',
            replyTo: p.clientReqId,
            assets: this.assets?.statuses() ?? [],
          }),
        );
        break;
      }
      case 'asset.ensure': {
        const assets = this.assets;
        if (!assets) {
          this.sendFailure(p.clientReqId, new Error('managed assets are unavailable on this host'));
          break;
        }
        // Rides the promise instead of awaiting: the reply lands only when the install settles
        // (minutes for a download), and this message's handling must finish before then.
        assets
          .ensure(p.id)
          .then((installed) => {
            if (!installed) {
              // Unknown asset or no version pin (e.g. the backing SDK is absent on this host).
              this.sendFailure(p.clientReqId, new Error(`asset ${p.id} cannot be installed here`));
              return;
            }
            const status = nullthrow(
              assets.statuses().find((candidate) => candidate.id === p.id),
              `installed asset ${p.id} missing from statuses`,
            );
            this.transport.send(
              createWireMessage({ kind: 'asset.ensured', replyTo: p.clientReqId, status }),
            );
          })
          .catch((err: unknown) => this.sendFailure(p.clientReqId, err));
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
      case 'file.read': {
        await this.tryReply(p.clientReqId, async () => {
          const file = await readWorkspaceFile(p.cwd, p.path);
          this.transport.send(
            createWireMessage({ kind: 'file.read.result', replyTo: p.clientReqId, file }),
          );
        });
        break;
      }
      case 'script.list': {
        const scripts = this.scripts;
        if (!scripts) {
          this.sendFailure(p.clientReqId, new Error('Scripts are not supported on this host'));
          break;
        }
        await this.tryReply(p.clientReqId, async () => {
          const list = await scripts.list(p.cwd);
          this.transport.send(
            createWireMessage({ kind: 'script.listed', replyTo: p.clientReqId, scripts: list }),
          );
        });
        break;
      }
      case 'script.start': {
        const scripts = this.scripts;
        if (!scripts) {
          this.sendFailure(p.clientReqId, new Error('Scripts are not supported on this host'));
          break;
        }
        await this.tryReply(p.clientReqId, async () => {
          await scripts.start(p.cwd, p.scriptName);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'script.stop': {
        const scripts = this.scripts;
        if (!scripts) {
          this.sendFailure(p.clientReqId, new Error('Scripts are not supported on this host'));
          break;
        }
        await this.tryReply(p.clientReqId, () => {
          scripts.stop(p.cwd, p.scriptName);
          this.sendSuccess(p.clientReqId);
          return Promise.resolve();
        });
        break;
      }
      case 'artifact.host': {
        await this.tryReply(p.clientReqId, () => {
          const artifact = this.artifactHost.host(p.content, p.mimeType);
          this.transport.send(
            createWireMessage({ kind: 'artifact.hosted', replyTo: p.clientReqId, artifact }),
          );
          return Promise.resolve();
        });
        break;
      }
      case 'artifact.revoke': {
        this.artifactHost.revoke(p.hash);
        this.sendSuccess(p.clientReqId);
        break;
      }
      case 'session.attach': {
        // Multi-device attach is implicit: events are broadcast to all clients. The one buffered
        // state an attaching client can't recover otherwise is the approval-policy advertisement
        // (emitted at adapter start); re-broadcast it — clients fold it idempotently.
        const attached = this.sessions.get(p.sessionId);
        if (attached?.approvalPolicy) {
          this.transport.send(
            createWireMessage({
              kind: 'agent.event',
              sessionId: p.sessionId,
              event: { type: 'approval-policy-update', state: attached.approvalPolicy },
            }),
          );
        }
        break;
      }
      case 'session.detach': {
        // No-op: events are broadcast to all clients, so there is nothing to unsubscribe per client.
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
    this.scripts?.shutdown();
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
      // The adapter invokes this synchronously; an uncaught throw here would bubble out of
      // whatever triggered the event (the adapter's own internals, in most cases) instead of
      // staying contained to this session.
      try {
        switch (event.type) {
          case 'status':
            session.status = event.status;
            if (event.status === 'stopped') this.sealCurrentRun(sessionId);
            break;
          case 'session-ref':
            this.bindSessionRef(sessionId, event.historyId);
            break;
          case 'approval-policy-update':
            session.approvalPolicy = event.state;
            break;
          default:
            break;
        }
        this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
      } catch (err) {
        console.error(`Error handling adapter event for session ${sessionId}:`, err);
      }
    });
    this.sessions.set(sessionId, session);
    this.records.set(sessionId, record);
    // persistRecord() never throws (see its doc) — a disk failure here logs and moves on rather
    // than failing this request or leaving the session registered without a caller-visible error.
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
    // A session.stop/session.delete handled while the adapter was still starting has already torn
    // this binding down; announcing it as started would leak a live adapter nothing tracks.
    if (this.sessions.get(sessionId) !== session) {
      await adapter.stop().catch(noop);
      throw new Error(`Session was closed while starting: ${sessionId}`);
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

  /**
   * Persist best-effort: `this.records` (in-memory) is the source of truth for a running daemon,
   * so a persistence failure is logged, not surfaced to the caller — it must never fail the
   * request that triggered it (e.g. `session.start`) or unwind a session that is already live.
   * `sessionStore.save` may throw synchronously (the daemon's drizzle/better-sqlite3 store) or
   * reject asynchronously; both are caught and logged here.
   */
  private persistRecord(record: SessionRecord): void {
    record.updatedAt = Date.now();
    void this.persistRecordSafely(record);
  }

  /**
   * `await` inside `try` catches both a synchronous throw (the daemon's drizzle/better-sqlite3
   * store) and an async rejection with the same catch block, so this never rejects.
   */
  private async persistRecordSafely(record: SessionRecord): Promise<void> {
    try {
      await this.sessionStore.save(record);
    } catch (err) {
      console.error(`Failed to persist session record ${record.sessionId}:`, err);
    }
  }

  private async tryReply(replyTo: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.sendFailure(replyTo, err);
    }
  }

  /** Forward AssetManager lifecycle to the wire, whoever triggered the install (client or boot). */
  private onAssetInstallEvent(event: AssetInstallEvent): void {
    switch (event.kind) {
      case 'progress': {
        const now = Date.now();
        if (now - (this.assetProgressSentAt.get(event.id) ?? 0) < ASSET_PROGRESS_INTERVAL_MS) {
          return;
        }
        this.assetProgressSentAt.set(event.id, now);
        this.transport.send(
          createWireMessage({
            kind: 'asset.progress',
            id: event.id,
            receivedBytes: event.receivedBytes,
            totalBytes: event.totalBytes,
          }),
        );
        break;
      }
      case 'installed': {
        this.assetProgressSentAt.delete(event.id);
        this.transport.send(
          createWireMessage({ kind: 'asset.settled', id: event.id, installed: event.installed }),
        );
        // A freshly installed agent binary changes what this host can spawn — re-probe so
        // `agent-runtime.list` stops serving the stale boot snapshot, and push the new truth.
        if (event.id.startsWith('agent:')) void this.refreshAgentRuntimes();
        break;
      }
      case 'failed': {
        this.assetProgressSentAt.delete(event.id);
        this.transport.send(
          createWireMessage({ kind: 'asset.settled', id: event.id, error: event.error }),
        );
        break;
      }
      // no default
    }
  }

  private async refreshAgentRuntimes(): Promise<void> {
    if (!this.collectAgentRuntimes) return;
    try {
      this.agentRuntimes = await this.collectAgentRuntimes();
      this.transport.send(
        createWireMessage({ kind: 'agent-runtime.changed', runtimes: this.agentRuntimes }),
      );
    } catch (err) {
      console.error('Re-probing agent runtimes after a managed install failed:', err);
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
