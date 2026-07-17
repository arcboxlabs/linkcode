import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { AUTH_FAILED_ERROR_CODE, createAdapter } from '@linkcode/agent-adapter';
import type {
  AgentCapabilities,
  AgentCommand,
  AgentEvent,
  AgentHistoryId,
  AgentKind,
  AgentModelOption,
  AgentRuntimes,
  ApprovalPolicyState,
  AssetInstallEvent,
  ContentBlock,
  EffortLevel,
  InstalledAsset,
  ManagedAssetId,
  ManagedAssetStatus,
  SessionAutomation,
  SessionId,
  SessionInfo,
  SessionNotificationReason,
  SessionRecord,
  StartOptions,
  WireMessage,
  WorkspaceRecord,
} from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import type { LoginBinaryResolver } from './agent-login-service';
import { AgentLoginService } from './agent-login-service';
import { ArtifactHostService } from './artifacts/host-service';
import type { AskEvent, AskResolutionEvent, AskResponseInput } from './ask-response';
import { sessionCancellation, userResolution, validateAskResponse } from './ask-response';
import { assertAttachmentContentAllowed } from './attachment-guard';
import type { LoopStore, ScheduleStore, SessionDriver } from './automation';
import {
  InMemoryLoopStore,
  InMemoryScheduleStore,
  LoopService,
  ScheduleService,
  watchTurn,
} from './automation';
import { readWorkspaceFile } from './file-service';
import { FileSuggestService } from './file-suggest-service';
import { GitService } from './git/git-service';
import { HistoryService } from './history-service';
import { jsonValueEqual } from './json-equal';
import type { ProviderConfigStore } from './provider-config';
import { applyProviderDefaults, InMemoryProviderConfigStore } from './provider-config';
import type { PtyBackend } from './pty-backend';
import { PreviewRouteRegistry } from './scripts/route-registry';
import { ScriptService } from './scripts/script-service';
import type { SessionStore } from './session-store';
import { InMemorySessionStore } from './session-store';
import { TerminalService } from './terminal-service';
import type { TranslatorService } from './translator';
import { translationUpstream, withTranslatorEndpoint } from './translator';
import { WorkspaceRegistry } from './workspace-registry';
import type { WorkspaceStore } from './workspace-store';
import { InMemoryWorkspaceStore } from './workspace-store';

interface Session {
  adapter: AgentAdapter;
  unsub: Unsubscribe;
  status: SessionInfo['status'];
  /** Set before Engine-initiated stop/delete teardown so suspended input handlers cannot reopen it. */
  closed: boolean;
  /** Engine-owned input gate: adapters differ in whether send() blocks for dispatch or a full turn,
   * so the host serializes turn-initiating inputs until the adapter reports idle/stopped. */
  turnInputActive: boolean;
  /** Latest advertised approval-policy state, replayed to freshly-attached clients — the event is
   * emitted at adapter start / on switches, which a client that (re)connects later has missed. */
  approvalPolicy?: ApprovalPolicyState;
  /** Interactive asks and their response lifecycle. Attach replays unresolved requests (plus an
   * in-flight status) or the latest turn's resolved outcomes. A new turn drops resolved tombstones
   * so this live-state cache cannot grow with session history. */
  asks: Map<string, AskRecord>;
  /** Latest model/effort the adapter reported, replayed to freshly-attached clients for the same
   * reason as `approvalPolicy` — a reconnecting client missed the emit and would otherwise show a
   * placeholder instead of the value the session is actually running on. */
  currentModel?: string;
  currentEffort?: EffortLevel;
  /** Latest slash-command catalog the adapter advertised, replayed on attach for the same reason —
   * without it a reconnecting client's composer loses the command menu. */
  availableCommands?: AgentCommand[];
  /** Latest model catalog the adapter advertised (install-dependent agents only), replayed on
   * attach for the same reason — without it a reconnecting client loses the model picker. */
  availableModels?: AgentModelOption[];
  /** Stable adapter input surface, replayed on attach so clients never infer it from agent kind. */
  capabilities: AgentCapabilities;
}

type AskRecord =
  | { request: AskEvent; state: 'open' }
  | { request: AskEvent; state: 'responding'; invalidated: boolean }
  | { request: AskEvent; state: 'resolved'; resolution: AskResolutionEvent };

/** Optional collaborators the daemon injects; each defaults to an in-memory/no-op implementation. */
export interface EngineDeps {
  factory?: AdapterFactory;
  sessionStore?: SessionStore;
  ptyBackend?: PtyBackend;
  providerStore?: ProviderConfigStore;
  git?: GitService;
  fileSuggest?: FileSuggestService;
  workspaceStore?: WorkspaceStore;
  /** Shared with the transport's reverse proxy; scripts need a PTY backend to run. */
  previewRoutes?: PreviewRouteRegistry;
  /** Boot-time probe result (`collectAgentRuntimes()`), served to clients on `agent-runtime.list`. */
  agentRuntimes?: AgentRuntimes;
  /** In-flight boot probe (CODE-225). The daemon binds listeners without waiting on the CLI
   * spawns behind `collect()`, handing the pending promise in instead: the engine seeds the
   * snapshot from it, holds `agent-runtime.list` replies and live-session starts until it
   * settles, and pushes the seeded result as `agent-runtime.changed`. */
  agentRuntimesReady?: Promise<AgentRuntimes>;
  /** Managed-asset store, served on `asset.list` and driven by `asset.ensure`. */
  assets?: AssetService;
  /** Re-probe hook: refreshes the served runtime snapshot after a managed agent install lands,
   * a login settles, a turn fails on auth, or a client read revalidates it (CODE-172). */
  collectAgentRuntimes?: () => Promise<AgentRuntimes>;
  /** Resolves the CLI to spawn for an interactive `agent-login`; absent hosts reject login requests. */
  resolveLoginBinary?: LoginBinaryResolver;
  /** Local Anthropic⇄OpenAI translation sidecar; absent Engines reject cross-protocol accounts. */
  translator?: TranslatorService;
  /** Durable store for schedules; the in-memory default keeps bare engines and tests dependency-free. */
  scheduleStore?: ScheduleStore;
  /** Durable store for loops; the in-memory default keeps bare engines and tests dependency-free. */
  loopStore?: LoopStore;
}

/** The slice of the daemon's AssetManager the engine consumes (live service, not a snapshot). */
export interface AssetService {
  statuses(): ManagedAssetStatus[];
  ensure(id: ManagedAssetId): Promise<InstalledAsset | undefined>;
  subscribe(listener: (event: AssetInstallEvent) => void): () => void;
}

/** Progress broadcasts are throttled per asset so a fast download can't flood the wire. */
const ASSET_PROGRESS_INTERVAL_MS = 150;

/** A read-triggered re-probe spawns agent CLIs (`--version`, `auth status`) — bound how often. */
const RUNTIME_REVALIDATE_COOLDOWN_MS = 5000;

/**
 * The local core engine — the "host" that runs the agents, carrier-agnostic
 * (docs/ARCHITECTURE.md#the-host-engine-adapters-abstraction, #core-principles).
 * Events broadcast to every attached client, so request/response control messages are correlated
 * by id: a request's `clientReqId` echoes back as `replyTo` on the matching reply.
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
  private readonly fileSuggest: FileSuggestService;
  private readonly scripts?: ScriptService;
  private readonly scheduler: ScheduleService;
  private readonly loops: LoopService;
  private readonly artifactHost: ArtifactHostService;
  /** Boot snapshot, replaced by every {@link enqueueRuntimesCollect} pass (install/login/auth
   * events and read-triggered revalidation alike). */
  private agentRuntimes: AgentRuntimes;
  /** Settles when {@link agentRuntimes} is authoritative — immediately, unless the daemon handed
   * in a pending boot probe (CODE-225). */
  private readonly agentRuntimesReady: Promise<void> = Promise.resolve();
  /** False only while that boot probe is in flight; gates the `agent-runtime.list` fast path. */
  private agentRuntimesSeeded = true;
  private readonly assets?: AssetService;
  private readonly logins?: AgentLoginService;
  private readonly translator?: TranslatorService;
  private readonly collectAgentRuntimes?: () => Promise<AgentRuntimes>;
  /** Tail of the runtime-collect queue: passes never overlap, so a pass queued for an event
   * (login settle, install) always probes after that event's effect landed on disk. */
  private runtimesCollect: Promise<void> = Promise.resolve();
  /** Queued + running collect passes; read-triggered revalidation coalesces onto them. */
  private runtimesCollectActive = 0;
  /** When the last collect pass SUCCEEDED (the read-revalidation cooldown reference); a failed
   * pass leaves it alone so the next read retries immediately. */
  private runtimesCollectedAt = 0;
  /** An event-triggered pass that has not started probing yet; simultaneous events join it. */
  private pendingEventPass: Promise<void> | undefined;
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
    this.fileSuggest = deps.fileSuggest ?? new FileSuggestService();
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
    this.scheduler = new ScheduleService(
      transport,
      deps.scheduleStore ?? new InMemoryScheduleStore(),
      this.buildSessionDriver(),
    );
    this.loops = new LoopService(
      transport,
      deps.loopStore ?? new InMemoryLoopStore(),
      this.buildSessionDriver(),
    );
    this.agentRuntimes = deps.agentRuntimes ?? {};
    if (deps.agentRuntimesReady) {
      this.agentRuntimesReady = this.seedAgentRuntimes(deps.agentRuntimesReady);
    }
    this.assets = deps.assets;
    this.translator = deps.translator;
    this.collectAgentRuntimes = deps.collectAgentRuntimes;
    this.logins = deps.resolveLoginBinary
      ? new AgentLoginService(transport, deps.resolveLoginBinary, () => {
          void this.refreshAgentRuntimes();
        })
      : undefined;
    // Lifetime = the daemon's: the engine is never disposed, so the subscription is never torn down.
    this.assets?.subscribe((event) => this.onAssetInstallEvent(event));
  }

  async start(): Promise<void> {
    for (const record of await this.sessionStore.load()) {
      this.records.set(record.sessionId, record);
    }
    await this.workspaces.start();
    // After the session records are loaded (the schedule orphan-sweep reads them) and before the
    // transport connects, so the first tick can't race an unconnected transport.
    await this.scheduler.start();
    // Loops don't resume across a restart; start() only sweeps interrupted loops to `stopped`.
    await this.loops.start();
    await this.transport.connect();
    this.transport.onMessage((msg) => {
      // Per-request failures already reply over the wire via tryReply; this is the last-resort
      // backstop for anything that throws before or outside that path (e.g. a malformed payload).
      this.handle(msg).catch((err: unknown) => {
        console.error('Unhandled error while processing message:', err);
      });
    });
  }

  /** Ensure the daemon-owned chat workspace exists at `cwd` ({@link WorkspaceRegistry.ensureChatWorkspace}).
   * Called once by the daemon at startup, before any client can connect. */
  ensureChatWorkspace(cwd: string): Promise<WorkspaceRecord> {
    return this.workspaces.ensureChatWorkspace(cwd);
  }

  /** Apply the bound account/provider defaults, then route a cross-protocol account through the
   * local translation sidecar; a session that needs translation with no sidecar available fails. */
  private async resolveStartOptions(opts: StartOptions): Promise<StartOptions> {
    const resolved = applyProviderDefaults(
      opts,
      this.providerStore.get(),
      this.providerStore.getAccounts(),
    );
    const upstream = translationUpstream(resolved);
    if (!upstream) return resolved;
    if (!this.translator) {
      throw new Error(
        'claude-code cross-protocol account needs the translation sidecar, which is unavailable',
      );
    }
    return withTranslatorEndpoint(resolved, await this.translator.ensure(upstream));
  }

  private async handle(msg: WireMessage): Promise<void> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.start': {
        await this.tryReply(p.clientReqId, async () => {
          const opts = await this.resolveStartOptions(p.opts);
          const now = Date.now();
          const record: SessionRecord = {
            sessionId: this.nextSessionId(),
            kind: opts.kind,
            cwd: opts.cwd,
            origin: { type: 'created' },
            createdVia: opts.createdVia,
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
          const startsTurn =
            p.input.type === 'prompt' ||
            p.input.type === 'command' ||
            p.input.type === 'shell-command';
          if (p.input.type === 'command') {
            const commandName = p.input.name;
            if (
              !session.capabilities.slashCommands ||
              !session.availableCommands?.some((command) =>
                agentCommandMatches(command, commandName),
              )
            ) {
              const error = new Error(`Unknown slash command: /${commandName}`);
              this.broadcastInputRejected(p.sessionId, error.message);
              throw error;
            }
          }
          if (p.input.type === 'shell-command' && !session.capabilities.shellCommand) {
            const error = new Error('Shell commands are not supported by this session');
            this.broadcastInputRejected(p.sessionId, error.message);
            throw error;
          }
          if (startsTurn && session.turnInputActive) {
            const error = new Error(`Session is busy: ${p.sessionId}`);
            this.broadcastInputRejected(p.sessionId, error.message);
            throw error;
          }
          if (startsTurn) session.turnInputActive = true;
          // Echo the prompt (and set the title) before awaiting send: provider events can outrun
          // the dispatch ack, so waiting would let assistant output arrive before its user turn.
          // A failed send still broadcasts input_rejected below and replies request.failed.
          if (p.input.type === 'prompt') {
            assertAttachmentContentAllowed(p.input.content);
            this.transport.send(
              createWireMessage({
                kind: 'agent.event',
                sessionId: p.sessionId,
                event: { type: 'user-message', content: p.input.content },
              }),
            );
            this.maybeSetTitle(p.sessionId, p.input.content);
          }
          // Echo command/shell inputs as the text the user typed so the transcript shows the
          // invocation; they never drive the title.
          if (p.input.type === 'command' || p.input.type === 'shell-command') {
            const text =
              p.input.type === 'command'
                ? `/${p.input.name}${p.input.arguments ? ` ${p.input.arguments}` : ''}`
                : `$ ${p.input.command}`;
            this.transport.send(
              createWireMessage({
                kind: 'agent.event',
                sessionId: p.sessionId,
                event: { type: 'user-message', content: [{ type: 'text', text }] },
              }),
            );
          }
          const responseInput =
            p.input.type === 'permission-response' || p.input.type === 'question-response'
              ? p.input
              : undefined;
          const respondingAsk = responseInput
            ? this.beginAskResponse(p.sessionId, session, responseInput)
            : undefined;
          try {
            await session.adapter.send(p.input);
          } catch (err) {
            if (responseInput && respondingAsk) {
              this.restoreAsk(p.sessionId, session, responseInput.requestId, respondingAsk);
            }
            if (startsTurn && session.status !== 'running') session.turnInputActive = false;
            if (startsTurn) {
              this.broadcastInputRejected(
                p.sessionId,
                extractErrorMessage(err) ?? 'Agent input was rejected',
              );
            }
            throw err;
          }
          if (responseInput && respondingAsk) {
            this.resolveUserAsk(p.sessionId, session, responseInput, respondingAsk);
          }
          // Synchronous controls such as Codex /compact may not produce lifecycle events. A real
          // turn has reported running by this point — BaseAgentAdapter's turn contract requires
          // turn-starting hooks to emit it before send() resolves — and stays gated until its
          // idle/stopped event.
          if (startsTurn && session.status !== 'running') session.turnInputActive = false;
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
          this.closeSessionInteractions(p.sessionId, session);
          session.unsub();
          try {
            await session.adapter.stop();
          } finally {
            this.sessions.delete(p.sessionId);
            this.terminals?.killBySession(p.sessionId);
            this.sealCurrentRun(p.sessionId);
          }
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.delete': {
        await this.tryReply(p.clientReqId, async () => {
          // Idempotent, unlike session.stop: the target is usually cold or already deleted by
          // another client. Provider-local history stays untouched, so session.import still works.
          const session = this.sessions.get(p.sessionId);
          if (session) {
            this.closeSessionInteractions(p.sessionId, session);
            session.unsub();
            try {
              await session.adapter.stop();
            } catch (error) {
              this.sealCurrentRun(p.sessionId);
              throw error;
            } finally {
              this.sessions.delete(p.sessionId);
              this.terminals?.killBySession(p.sessionId);
            }
          }
          // Persisted delete first: if the store throws, the record stays listed (now cold) and the
          // client's retry still works — dropping it from memory first would desync the two.
          try {
            await this.sessionStore.delete(p.sessionId);
          } catch (error) {
            if (session) this.sealCurrentRun(p.sessionId);
            throw error;
          }
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
        await this.tryReply(p.clientReqId, () =>
          this.resumeSessionById(p.clientReqId, p.sessionId),
        );
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
          const startOpts = await this.resolveStartOptions({ ...p.startOpts, kind: p.agentKind });
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
        if (this.agentRuntimesSeeded) {
          this.replyAgentRuntimes(p.clientReqId);
        } else {
          // Held until the boot probe lands (CODE-225): a pre-probe snapshot reads as every
          // agent missing, and under prompt-first installs (CODE-221) the Download card that
          // presents is a consent surface — it must not appear on transient ignorance.
          void this.agentRuntimesReady.then(() => this.replyAgentRuntimes(p.clientReqId));
        }
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
            accounts: this.providerStore.getAccounts(),
          }),
        );
        break;
      }
      case 'config.set': {
        await this.tryReply(p.clientReqId, async () => {
          // Each field is independent: a client editing only providers preserves the account pool,
          // and one editing only accounts preserves the provider settings.
          if (p.providers !== undefined) await this.providerStore.set(p.providers);
          if (p.accounts !== undefined) await this.providerStore.setAccounts(p.accounts);
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
      case 'file.list': {
        await this.tryReply(p.clientReqId, async () => {
          // Same opened-roots scoping as file.suggest below.
          const workspace = nullthrow(
            this.workspaces.findByCwd(p.cwd),
            `Unknown workspace: ${p.cwd}`,
          );
          const files = await this.fileSuggest.list(workspace.cwd);
          this.transport.send(
            createWireMessage({ kind: 'file.list.result', replyTo: p.clientReqId, files }),
          );
        });
        break;
      }
      case 'file.suggest': {
        await this.tryReply(p.clientReqId, async () => {
          // Refuse a cwd no session ever ran in (opened-roots scoping, not a hard boundary);
          // the search runs under the registered record's cwd, not the caller's spelling.
          const workspace = nullthrow(
            this.workspaces.findByCwd(p.cwd),
            `Unknown workspace: ${p.cwd}`,
          );
          const suggestions = await this.fileSuggest.suggest(workspace.cwd, p.query, p.limit);
          this.transport.send(
            createWireMessage({ kind: 'file.suggest.result', replyTo: p.clientReqId, suggestions }),
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
      case 'schedule.create': {
        await this.tryReply(p.clientReqId, async () => {
          const schedule = await this.scheduler.create(p.spec);
          this.transport.send(
            createWireMessage({ kind: 'schedule.created', replyTo: p.clientReqId, schedule }),
          );
        });
        break;
      }
      case 'schedule.update': {
        await this.tryReply(p.clientReqId, async () => {
          const schedule = await this.scheduler.update(p.scheduleId, p.patch);
          this.transport.send(
            createWireMessage({ kind: 'schedule.updated', replyTo: p.clientReqId, schedule }),
          );
        });
        break;
      }
      case 'schedule.delete': {
        await this.tryReply(p.clientReqId, async () => {
          await this.scheduler.delete(p.scheduleId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'schedule.pause': {
        await this.tryReply(p.clientReqId, async () => {
          await this.scheduler.pause(p.scheduleId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'schedule.resume': {
        await this.tryReply(p.clientReqId, async () => {
          await this.scheduler.resume(p.scheduleId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'schedule.run-once': {
        await this.tryReply(p.clientReqId, () => {
          this.scheduler.runOnce(p.scheduleId);
          this.sendSuccess(p.clientReqId);
          return Promise.resolve();
        });
        break;
      }
      case 'schedule.list': {
        this.transport.send(
          createWireMessage({
            kind: 'schedule.listed',
            replyTo: p.clientReqId,
            schedules: this.scheduler.list(),
          }),
        );
        break;
      }
      case 'schedule.runs.list': {
        await this.tryReply(p.clientReqId, async () => {
          const runs = await this.scheduler.listRuns(p.scheduleId, p.limit);
          this.transport.send(
            createWireMessage({ kind: 'schedule.runs.listed', replyTo: p.clientReqId, runs }),
          );
        });
        break;
      }
      case 'loop.start': {
        await this.tryReply(p.clientReqId, async () => {
          const loop = await this.loops.startLoop(p.spec);
          this.transport.send(
            createWireMessage({ kind: 'loop.started', replyTo: p.clientReqId, loop }),
          );
        });
        break;
      }
      case 'loop.stop': {
        await this.tryReply(p.clientReqId, () => {
          this.loops.stopLoop(p.loopId);
          this.sendSuccess(p.clientReqId);
          return Promise.resolve();
        });
        break;
      }
      case 'loop.delete': {
        await this.tryReply(p.clientReqId, async () => {
          await this.loops.deleteLoop(p.loopId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'loop.list': {
        this.transport.send(
          createWireMessage({
            kind: 'loop.listed',
            replyTo: p.clientReqId,
            loops: this.loops.list(),
          }),
        );
        break;
      }
      case 'loop.inspect': {
        await this.tryReply(p.clientReqId, async () => {
          const { loop, iterations, logs } = await this.loops.inspect(p.loopId);
          this.transport.send(
            createWireMessage({
              kind: 'loop.inspected',
              replyTo: p.clientReqId,
              loop,
              iterations,
              logs,
            }),
          );
        });
        break;
      }
      case 'session.attach': {
        // The Hub has already attached this connection to the session before forwarding the frame.
        // Re-emit the buffered state that a history read cannot recover: live status (which gates
        // pending-ask cards and the Stop affordance), adapter capabilities and approval policy,
        // the latest command catalog, and live permission/question state. Unresolved asks replay
        // their request; settled asks replay only their outcome so old cards cannot enter a later
        // turn. Clients fold this state idempotently and dedupe asks by requestId.
        const attached = this.sessions.get(p.sessionId);
        if (!attached) break;
        const replay = (event: AgentEvent): void => {
          this.transport.send(
            createWireMessage({ kind: 'agent.event', sessionId: p.sessionId, event }),
          );
        };
        replay({ type: 'status', status: attached.status });
        if (attached.approvalPolicy) {
          replay({ type: 'approval-policy-update', state: attached.approvalPolicy });
        }
        if (attached.currentModel) {
          replay({ type: 'model-update', model: attached.currentModel });
        }
        if (attached.currentEffort) {
          replay({ type: 'effort-update', effort: attached.currentEffort });
        }
        replay({ type: 'capabilities-update', capabilities: attached.capabilities });
        if (attached.availableCommands) {
          replay({ type: 'available-commands-update', commands: attached.availableCommands });
        }
        if (attached.availableModels) {
          replay({ type: 'available-models-update', models: attached.availableModels });
        }
        for (const ask of attached.asks.values()) {
          if (ask.state === 'resolved') {
            replay(ask.resolution);
          } else {
            replay(ask.request);
            if (ask.state === 'responding') {
              replay({
                type: 'prompt-response-status',
                requestId: ask.request.requestId,
                status: 'responding',
              });
            }
          }
        }
        break;
      }
      case 'session.detach': {
        // No-op in the Engine: the Hub already removed this connection's session subscription.
        break;
      }
      case 'terminal.open': {
        const terminals = this.terminals;
        if (!terminals) {
          this.sendFailure(p.clientReqId, new Error('Terminals are not supported on this host'));
          break;
        }
        await this.tryReply(p.clientReqId, () =>
          terminals.open(p.clientReqId, p.opts, {
            attachmentId: p.attachmentId,
            attachmentSecret: p.attachmentSecret,
          }),
        );
        break;
      }
      case 'terminal.list': {
        if (this.terminals) {
          this.terminals.list(p.clientReqId);
        } else {
          this.sendFailure(p.clientReqId, new Error('Terminals are not supported on this host'));
        }
        break;
      }
      case 'terminal.attach': {
        const terminals = this.terminals;
        if (!terminals) {
          this.sendFailure(p.clientReqId, new Error('Terminals are not supported on this host'));
          break;
        }
        await this.tryReply(p.clientReqId, () => {
          terminals.attach(
            p.clientReqId,
            p.terminalId,
            { attachmentId: p.attachmentId, attachmentSecret: p.attachmentSecret },
            p.mode,
          );
          return Promise.resolve();
        });
        break;
      }
      case 'terminal.detach': {
        this.terminals?.detach(p.terminalId, {
          attachmentId: p.attachmentId,
          attachmentSecret: p.attachmentSecret,
        });
        break;
      }
      case 'terminal.input': {
        this.terminals?.input(
          p.terminalId,
          { attachmentId: p.attachmentId, attachmentSecret: p.attachmentSecret },
          p.data,
        );
        break;
      }
      case 'terminal.resize': {
        this.terminals?.resize(
          p.terminalId,
          { attachmentId: p.attachmentId, attachmentSecret: p.attachmentSecret },
          p.cols,
          p.rows,
        );
        break;
      }
      case 'terminal.close': {
        this.terminals?.close(p.terminalId, {
          attachmentId: p.attachmentId,
          attachmentSecret: p.attachmentSecret,
        });
        break;
      }
      case 'agent-login.start': {
        const logins = this.logins;
        if (!logins) {
          this.sendFailure(p.clientReqId, new Error('Login is not supported on this host'));
          break;
        }
        logins.start(p.clientReqId, p.agent);
        break;
      }
      case 'agent-login.submit-code': {
        this.logins?.submitCode(p.loginId, p.code);
        break;
      }
      case 'agent-login.cancel': {
        this.logins?.cancel(p.loginId);
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

  async stop(): Promise<void> {
    // Stop launching new automation sessions before the session-teardown sweep runs.
    this.scheduler.shutdown();
    this.loops.shutdown();
    await Promise.all(
      Array.from(this.sessions.values(), async (session) => {
        session.unsub();
        await session.adapter.stop();
      }),
    );
    this.sessions.clear();
    this.scripts?.shutdown();
    this.terminals?.closeAll();
    this.logins?.closeAll();
    await this.translator?.closeAll();
    this.transport.close();
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
  }

  /** Bind a (new or resumed) record — its current run already last in `runs` — to a live adapter
   * run; the adapter's `session-ref` event later backfills that run's provider-local id. */
  private async startLiveSession(
    replyTo: string | undefined,
    record: SessionRecord,
    startAdapter: (adapter: AgentAdapter) => Promise<void>,
  ): Promise<void> {
    const sessionId = record.sessionId;
    const adapter = this.factory(record.kind);
    const session: Session = {
      adapter,
      unsub: noop,
      status: 'starting',
      closed: false,
      turnInputActive: false,
      asks: new Map(),
      capabilities: adapter.capabilities,
    };
    session.unsub = adapter.onEvent((event) => {
      // The adapter invokes this synchronously; an uncaught throw would bubble into whatever
      // triggered the event instead of staying contained to this session.
      try {
        switch (event.type) {
          case 'status':
            if (event.status === 'running' && session.status !== 'running') {
              for (const [requestId, ask] of session.asks) {
                if (ask.state === 'resolved') session.asks.delete(requestId);
              }
            }
            session.status = event.status;
            if (event.status === 'running') session.turnInputActive = true;
            if (event.status === 'idle' || event.status === 'stopped') {
              session.turnInputActive = false;
            }
            // A turn boundary invalidates every unanswered ask. Keep a canonical cancellation
            // record so attached clients converge instead of merely making the card disappear.
            if (event.status === 'idle' || event.status === 'stopped') {
              this.cancelOpenAsks(sessionId, session);
            }
            if (event.status === 'stopped') this.sealCurrentRun(sessionId);
            break;
          case 'session-ref':
            this.bindSessionRef(sessionId, event.historyId);
            break;
          case 'approval-policy-update':
            session.approvalPolicy = event.state;
            break;
          case 'permission-request':
          case 'question-request':
            if (!session.asks.has(event.requestId)) {
              session.asks.set(event.requestId, { request: event, state: 'open' });
            }
            break;
          case 'tool-call':
            // A terminal tool invalidates any still-open ask (also catches teardown's forced-failed
            // sweep on cancel), producing the explicit resolution clients use for pending state.
            if (event.toolCall.status === 'completed' || event.toolCall.status === 'failed') {
              this.cancelOpenAsks(sessionId, session, event.toolCall.toolCallId);
            }
            break;
          case 'model-update':
            session.currentModel = event.model;
            break;
          case 'effort-update':
            session.currentEffort = event.effort;
            break;
          case 'available-commands-update':
            session.availableCommands = event.commands;
            break;
          case 'available-models-update':
            session.availableModels = event.models;
            break;
          case 'capabilities-update':
            session.capabilities = event.capabilities;
            break;
          case 'error':
            // Signed-out/expired-token turn: re-probe so the runtime snapshot flips to
            // `loggedIn: false` and the client surfaces the login cue.
            if (event.code === AUTH_FAILED_ERROR_CODE) void this.refreshAgentRuntimes();
            break;
          default:
            break;
        }
        this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
        this.maybeNotify(sessionId, event);
      } catch (err) {
        console.error(`Error handling adapter event for session ${sessionId}:`, err);
      }
    });
    this.sessions.set(sessionId, session);
    this.records.set(sessionId, record);
    // persistRecord() never throws (see its doc) — a disk failure here logs and moves on rather
    // than failing this request or leaving the session registered without a caller-visible error.
    this.persistRecord(record);
    // A start can land between listener bind and the boot probe settling (CODE-225); wait, or
    // `resolveBinary` misses a detected-only install and a packaged host fails the spawn. The
    // wait sits AFTER registration so a session.delete arriving mid-wait finds the session and
    // tears it down — the guard then aborts this start instead of resurrecting the deleted record.
    await this.agentRuntimesReady;
    if (this.sessions.get(sessionId) !== session) {
      await adapter.stop().catch(noop);
      throw new Error(`Session was closed while starting: ${sessionId}`);
    }
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
    // Automation-driven sessions have no client awaiting a reply (replyTo === undefined).
    if (replyTo !== undefined) {
      this.transport.send(createWireMessage({ kind: 'session.started', replyTo, sessionId }));
    }
  }

  /**
   * The session-orchestration surface the automation services drive agents through, as bound
   * closures over the Engine's internals — so the services never import the Engine (avoiding a
   * cycle), mirroring how ScriptService receives a `workspaceName` lookup.
   */
  private buildSessionDriver(): SessionDriver {
    return {
      createSession: async (opts: {
        kind: AgentKind;
        cwd: string;
        model?: string;
        title?: string;
        automation: SessionAutomation;
      }): Promise<SessionId> => {
        const startOpts = await this.resolveStartOptions({
          kind: opts.kind,
          cwd: opts.cwd,
          model: opts.model,
        });
        const now = Date.now();
        const record: SessionRecord = {
          sessionId: this.nextSessionId(),
          kind: startOpts.kind,
          cwd: startOpts.cwd,
          title: opts.title,
          origin: { type: 'created' },
          automation: opts.automation,
          createdAt: now,
          updatedAt: now,
          runs: [{ startedAt: now }],
        };
        await this.startLiveSession(undefined, record, (adapter) => adapter.start(startOpts));
        if (startOpts.cwd) this.workspaces.touch(startOpts.cwd);
        return record.sessionId;
      },
      hasRecord: (sessionId) => this.records.has(sessionId),
      isBusy: (sessionId) => {
        const session = this.sessions.get(sessionId);
        return session !== undefined && (session.turnInputActive || session.status === 'running');
      },
      ensureLive: async (sessionId) => {
        if (this.sessions.has(sessionId)) return;
        await this.resumeSessionById(undefined, sessionId);
      },
      makeUnattended: async (sessionId) => {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        try {
          // Both policy-bearing adapters (claude-code, codex) name their most permissive policy
          // `bypassPermissions`; opencode/pi have no policy axis and reject this — swallowed, so a
          // later ask fails the run instead. Applied only to automation-created sessions.
          await session.adapter.send({
            type: 'set-approval-policy',
            policyId: 'bypassPermissions',
          });
        } catch {
          // Adapter has no approval-policy axis; unattended is best-effort.
        }
      },
      prompt: (sessionId, text, opts) => this.promptAutomationTurn(sessionId, text, opts),
      stopSession: (sessionId) => this.stopSessionById(sessionId),
    };
  }

  /** Echo a prompt into the broadcast stream, dispatch it, and wait for the turn (see watchTurn). */
  private promptAutomationTurn(
    sessionId: SessionId,
    text: string,
    opts?: { timeoutMs?: number },
  ): Promise<Awaited<ReturnType<typeof watchTurn>>> {
    const session = nullthrow(this.sessions.get(sessionId), `Unknown session: ${sessionId}`);
    if (session.turnInputActive) throw new Error(`Session is busy: ${sessionId}`);
    session.turnInputActive = true;
    const content: ContentBlock[] = [{ type: 'text', text }];
    this.transport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: { type: 'user-message', content },
      }),
    );
    this.maybeSetTitle(sessionId, content);
    return watchTurn(
      session.adapter,
      () => session.adapter.send({ type: 'prompt', content }),
      opts,
    ).catch((err: unknown) => {
      // The turn never latched running (fatal dispatch/ask); release the gate the status handler
      // would otherwise have cleared on idle/stopped.
      if (session.status !== 'running') session.turnInputActive = false;
      throw err;
    });
  }

  /** Stop a live session idempotently, keeping its record. Shared by session.stop and the driver. */
  private async stopSessionById(sessionId: SessionId): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.unsub();
    await session.adapter.stop().catch(noop);
    this.sessions.delete(sessionId);
    this.terminals?.killBySession(sessionId);
    this.sealCurrentRun(sessionId);
  }

  /**
   * Wake a cold session in place under the same Link Code id. Shared by the `session.resume` wire
   * handler (which passes its `clientReqId` so `startLiveSession` echoes `session.started`) and the
   * automation SessionDriver (which passes `undefined` — no client is awaiting a reply).
   */
  private async resumeSessionById(
    replyTo: string | undefined,
    sessionId: SessionId,
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session is already running: ${sessionId}`);
    }
    const record = nullthrow(this.records.get(sessionId), `Unknown session: ${sessionId}`);
    // A never-prompted session has no provider transcript to resume from (the adapter only mints one
    // on the first prompt); waking it is a fresh start under the same Link Code id.
    const historyId = latestHistoryId(record);
    const startOpts = await this.resolveStartOptions({ kind: record.kind, cwd: record.cwd });
    record.runs.push({ historyId, startedAt: Date.now() });
    await this.startLiveSession(replyTo, record, (adapter) =>
      historyId === undefined
        ? adapter.start(startOpts)
        : this.history.resume(adapter, historyId, startOpts),
    );
    // Same contract as session.start / history.resume: waking a session (re)registers its directory,
    // so imported records and roots archived since still pass the file.suggest workspace check once
    // their session is live again.
    if (record.cwd) this.workspaces.touch(record.cwd);
  }

  private beginAskResponse(
    sessionId: SessionId,
    session: Session,
    input: AskResponseInput,
  ): AskEvent {
    if (session.closed) throw new Error(`Session is closed: ${sessionId}`);
    const ask = session.asks.get(input.requestId);
    if (!ask) throw new Error(`Unknown interactive request: ${input.requestId}`);
    if (ask.state === 'responding') {
      throw new Error(`Response already in flight: ${input.requestId}`);
    }
    if (ask.state === 'resolved') {
      throw new Error(`Interactive request already resolved: ${input.requestId}`);
    }
    validateAskResponse(ask.request, input);
    session.asks.set(input.requestId, {
      request: ask.request,
      state: 'responding',
      invalidated: false,
    });
    this.transport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: {
          type: 'prompt-response-status',
          requestId: input.requestId,
          status: 'responding',
        },
      }),
    );
    return ask.request;
  }

  private restoreAsk(
    sessionId: SessionId,
    session: Session,
    requestId: string,
    request: AskEvent,
  ): void {
    if (session.closed) return;
    const ask = session.asks.get(requestId);
    if (ask?.state !== 'responding' || ask.request !== request) return;
    if (ask.invalidated) {
      const resolution = sessionCancellation(request);
      session.asks.set(requestId, { request, state: 'resolved', resolution });
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event: resolution }));
      return;
    }
    session.asks.set(requestId, { request, state: 'open' });
    this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event: request }));
    this.transport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: { type: 'prompt-response-status', requestId, status: 'open' },
      }),
    );
  }

  private resolveUserAsk(
    sessionId: SessionId,
    session: Session,
    input: AskResponseInput,
    request: AskEvent,
  ): void {
    // A session.stop/delete that raced the in-flight send has already cancelled every ask and
    // broadcast the resolutions; the adapter accepted the answer, so the send stays successful.
    if (session.closed) return;
    const ask = session.asks.get(input.requestId);
    if (ask?.state !== 'responding' || ask.request !== request) {
      throw new Error(`Interactive request changed while responding: ${input.requestId}`);
    }
    const resolution = userResolution(input);
    session.asks.set(input.requestId, { request, state: 'resolved', resolution });
    this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event: resolution }));
  }

  private cancelOpenAsks(sessionId: SessionId, session: Session, toolCallId?: string): void {
    for (const [requestId, ask] of session.asks) {
      if (toolCallId !== undefined && ask.request.toolCall.toolCallId !== toolCallId) continue;
      if (ask.state === 'responding') {
        session.asks.set(requestId, { ...ask, invalidated: true });
      } else if (ask.state === 'open') {
        const resolution = sessionCancellation(ask.request);
        session.asks.set(requestId, { request: ask.request, state: 'resolved', resolution });
        this.transport.send(
          createWireMessage({ kind: 'agent.event', sessionId, event: resolution }),
        );
      }
    }
  }

  private closeSessionInteractions(sessionId: SessionId, session: Session): void {
    if (session.closed) return;
    session.closed = true;
    session.status = 'stopped';
    session.turnInputActive = false;
    for (const [requestId, ask] of session.asks) {
      if (ask.state === 'resolved') continue;
      const resolution = sessionCancellation(ask.request);
      session.asks.set(requestId, { request: ask.request, state: 'resolved', resolution });
      this.transport.send(createWireMessage({ kind: 'agent.event', sessionId, event: resolution }));
    }
    this.transport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: { type: 'status', status: 'stopped' },
      }),
    );
  }

  private broadcastInputRejected(sessionId: SessionId, message: string): void {
    this.transport.send(
      createWireMessage({
        kind: 'agent.event',
        sessionId,
        event: { type: 'error', message, code: 'input_rejected', recoverable: true },
      }),
    );
  }

  /** Classification is daemon-side so clients never fold background sessions' event streams;
   * surfacing is client-side policy. Must stay a broadcast even once per-connection subscription
   * modes exist (CODE-72). */
  private maybeNotify(sessionId: SessionId, event: AgentEvent): void {
    const reason = notificationReason(event);
    const record = this.records.get(sessionId);
    if (!reason || !record) return;
    this.transport.send(
      createWireMessage({
        kind: 'session.notification',
        notification: {
          sessionId,
          kind: record.kind,
          cwd: record.cwd,
          title: record.title,
          reason,
        },
      }),
    );
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
      createdVia: record.createdVia,
      automation: record.automation,
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

  /** Persist best-effort: `this.records` is the source of truth for a running daemon, so a save
   * failure (sync throw or async rejection) is logged and must never fail the triggering request. */
  private persistRecord(record: SessionRecord): void {
    record.updatedAt = Date.now();
    void this.persistRecordSafely(record);
  }

  /** `await` inside `try` catches both a sync throw and an async rejection, so this never rejects. */
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

  /** Reply to `agent-runtime.list`, then serve-stale-and-revalidate (CODE-172): login state and
   * user CLI installs change behind the daemon's back, so a read also kicks a background
   * re-probe; a differing result is pushed as `agent-runtime.changed`. */
  private replyAgentRuntimes(replyTo: string): void {
    this.transport.send(
      createWireMessage({
        kind: 'agent-runtime.listed',
        replyTo,
        runtimes: this.agentRuntimes,
      }),
    );
    this.revalidateAgentRuntimes();
  }

  /**
   * First pass of the runtime-collect queue: adopt the boot probe the daemon started before
   * binding listeners (CODE-225). Seeds the snapshot, arms the read-revalidation cooldown, and
   * pushes the result; event/read passes queue behind it via {@link runtimesCollect}. A failed
   * probe seeds nothing and leaves the cooldown unarmed, so the next read re-probes immediately.
   */
  private seedAgentRuntimes(ready: Promise<AgentRuntimes>): Promise<void> {
    this.agentRuntimesSeeded = false;
    this.runtimesCollectActive += 1;
    const pass = ready
      .then((runtimes) => {
        this.agentRuntimes = runtimes;
        this.runtimesCollectedAt = Date.now();
        this.transport.send(createWireMessage({ kind: 'agent-runtime.changed', runtimes }));
      })
      .catch((err: unknown) => {
        console.error('Boot agent-runtime probe failed:', err);
      })
      .finally(() => {
        this.agentRuntimesSeeded = true;
        this.runtimesCollectActive -= 1;
      });
    this.runtimesCollect = pass;
    return pass;
  }

  /**
   * Event-triggered re-probe (managed agent install landed, interactive login settled, a turn
   * failed with `authentication_failed`): the push is unconditional — clients treat it as the
   * settle signal for install/login activity — and the pass queues behind any in-flight collect,
   * which may have probed before the event's effect (credentials, binaries) hit disk.
   * Simultaneous events (e.g. every open session 401ing on one expired credential) coalesce onto
   * a queued pass that has not started probing — it observes all their effects; a pass already
   * probing may predate them and cannot be joined.
   */
  private refreshAgentRuntimes(): Promise<void> {
    if (!this.collectAgentRuntimes) return Promise.resolve();
    const pending = this.pendingEventPass;
    if (pending) return pending;
    const pass = this.enqueueRuntimesCollect(true, () => {
      if (this.pendingEventPass === pass) this.pendingEventPass = undefined;
    });
    this.pendingEventPass = pass;
    return pass;
  }

  /** Read-triggered revalidation for `agent-runtime.list` (CODE-172): out-of-band changes surface
   * on the next read. Coalesced, rate-limited, and diff-gated — every client re-reads on the
   * `agent-runtime.changed` push this produces, so the read→push→read cycle must converge. */
  private revalidateAgentRuntimes(): void {
    if (!this.collectAgentRuntimes) return;
    if (this.runtimesCollectActive > 0) return;
    if (Date.now() - this.runtimesCollectedAt < RUNTIME_REVALIDATE_COOLDOWN_MS) return;
    void this.enqueueRuntimesCollect(false);
  }

  /** Append one collect pass to the queue; `pushUnchanged` lifts the diff gate on the broadcast
   * and `onStart` fires when the pass begins probing (after any queued predecessors drained). */
  private enqueueRuntimesCollect(pushUnchanged: boolean, onStart?: () => void): Promise<void> {
    const collect = this.collectAgentRuntimes;
    if (!collect) return Promise.resolve();
    this.runtimesCollectActive += 1;
    const pass = this.runtimesCollect.then(async () => {
      onStart?.();
      try {
        const next = await collect();
        const changed = !jsonValueEqual(next, this.agentRuntimes);
        this.agentRuntimes = next;
        this.runtimesCollectedAt = Date.now();
        if (changed || pushUnchanged) {
          this.transport.send(createWireMessage({ kind: 'agent-runtime.changed', runtimes: next }));
        }
      } catch (err) {
        console.error('Re-probing agent runtimes failed:', err);
      } finally {
        this.runtimesCollectActive -= 1;
      }
    });
    this.runtimesCollect = pass;
    return pass;
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

/** The notification-worthy subset of adapter events. `stop` marks the turn boundary (`idle` also
 * fires at session start, so it can't be the trigger); an ask is the only "awaiting input" signal
 * any adapter emits. */
function notificationReason(event: AgentEvent): SessionNotificationReason | undefined {
  switch (event.type) {
    case 'stop':
      return { type: 'turn-completed', stopReason: event.stopReason };
    case 'permission-request':
    case 'question-request':
      return { type: 'awaiting-approval', toolTitle: event.toolCall.title };
    case 'error':
      return { type: 'error', message: event.message };
    default:
      return undefined;
  }
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
