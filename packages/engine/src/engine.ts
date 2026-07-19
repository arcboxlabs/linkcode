import type { AdapterFactory } from '@linkcode/agent-adapter';
import { createAdapter } from '@linkcode/agent-adapter';
import type {
  AgentKind,
  AgentRuntimes,
  SessionAutomation,
  SessionId,
  SessionRecord,
  StartOptions,
  WireMessage,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import type { LoginBinaryResolver } from './agent/login-service';
import { AgentLoginService } from './agent/login-service';
import type { ProviderConfigStore } from './agent/provider-config';
import { applyProviderDefaults, InMemoryProviderConfigStore } from './agent/provider-config';
import { AgentRuntimeService } from './agent/runtime-service';
import type { TranslatorService } from './agent/translator';
import { translationUpstream, withTranslatorEndpoint } from './agent/translator';
import type { AssetService } from './asset/service';
import { ManagedAssetService } from './asset/service';
import type { LoopStore, ScheduleStore, SessionDriver } from './automation';
import {
  InMemoryLoopStore,
  InMemoryScheduleStore,
  LoopService,
  ScheduleService,
} from './automation';
import { AutomationRequestHandler } from './automation/request-handler';
import { GitService } from './git/git-service';
import { ArtifactHostService } from './preview/artifact-host-service';
import { ArtifactRequestHandler } from './preview/request-handler';
import { PreviewRouteRegistry } from './preview/route-registry';
import { ScriptRequestHandler } from './scripts/request-handler';
import { ScriptService } from './scripts/script-service';
import { HistoryService } from './session/history-service';
import { SessionOrchestrator } from './session/orchestrator';
import { SessionRecordRegistry } from './session/session-record-registry';
import type { SessionStore } from './session/session-store';
import { InMemorySessionStore } from './session/session-store';
import type { PtyBackend } from './terminal/pty-backend';
import { TerminalRequestHandler } from './terminal/request-handler';
import { TerminalService } from './terminal/service';
import { WireResponder } from './wire/responder';
import { readWorkspaceFile } from './workspace/file-service';
import { FileSuggestService } from './workspace/file-suggest-service';
import { WorkspaceRegistry } from './workspace/workspace-registry';
import type { WorkspaceStore } from './workspace/workspace-store';
import { InMemoryWorkspaceStore } from './workspace/workspace-store';

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

/**
 * The local core engine — the "host" that runs the agents, carrier-agnostic
 * (docs/ARCHITECTURE.md#the-host-engine-adapters-abstraction, #core-principles).
 * Events broadcast to every attached client, so request/response control messages are correlated
 * by id: a request's `clientReqId` echoes back as `replyTo` on the matching reply.
 */
export class Engine {
  private readonly sessions: SessionOrchestrator;
  private readonly records: SessionRecordRegistry;
  private readonly history: HistoryService;
  private readonly terminals?: TerminalService;
  private readonly terminalRequests: TerminalRequestHandler;
  private readonly responder: WireResponder;
  private readonly workspaces: WorkspaceRegistry;
  private readonly providerStore: ProviderConfigStore;
  private readonly git: GitService;
  private readonly fileSuggest: FileSuggestService;
  private readonly scripts?: ScriptService;
  private readonly scriptRequests: ScriptRequestHandler;
  private readonly scheduler: ScheduleService;
  private readonly loops: LoopService;
  private readonly automationRequests: AutomationRequestHandler;
  private readonly artifactRequests: ArtifactRequestHandler;
  private readonly runtimes: AgentRuntimeService;
  private readonly assets: ManagedAssetService;
  private readonly logins?: AgentLoginService;
  private readonly translator?: TranslatorService;
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    deps: EngineDeps = {},
  ) {
    this.responder = new WireResponder(transport);
    const factory = deps.factory ?? createAdapter;
    this.providerStore = deps.providerStore ?? new InMemoryProviderConfigStore();
    this.records = new SessionRecordRegistry(deps.sessionStore ?? new InMemorySessionStore());
    this.git = deps.git ?? new GitService();
    this.fileSuggest = deps.fileSuggest ?? new FileSuggestService();
    this.history = new HistoryService(factory);
    this.runtimes = new AgentRuntimeService({
      initial: deps.agentRuntimes,
      ready: deps.agentRuntimesReady,
      collect: deps.collectAgentRuntimes,
      onChanged: (runtimes) => {
        this.transport.send(createWireMessage({ kind: 'agent-runtime.changed', runtimes }));
      },
      onError(message, error) {
        console.error(message, error);
      },
    });
    this.sessions = new SessionOrchestrator(
      transport,
      factory,
      this.records,
      this.runtimes,
      (sessionId) => this.terminals?.killBySession(sessionId),
    );
    this.terminals = deps.ptyBackend
      ? new TerminalService(deps.ptyBackend, transport, (id) => this.sessions.has(id))
      : undefined;
    this.terminalRequests = new TerminalRequestHandler(this.terminals, this.responder);
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
    this.scriptRequests = new ScriptRequestHandler(transport, this.scripts, this.responder);
    this.artifactRequests = new ArtifactRequestHandler(
      transport,
      new ArtifactHostService(routes),
      this.responder,
    );
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
    this.automationRequests = new AutomationRequestHandler(
      transport,
      this.scheduler,
      this.loops,
      this.responder,
    );
    this.assets = new ManagedAssetService(transport, deps.assets, () => {
      void this.runtimes.refresh();
    });
    this.translator = deps.translator;
    this.logins = deps.resolveLoginBinary
      ? new AgentLoginService(transport, deps.resolveLoginBinary, () => {
          void this.runtimes.refresh();
        })
      : undefined;
  }

  async start(): Promise<void> {
    await this.records.load();
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
          await this.sessions.startLive(p.clientReqId, record, (adapter) => adapter.start(opts));
          if (opts.cwd) this.workspaces.touch(opts.cwd);
        });
        break;
      }
      case 'agent.input': {
        await this.tryReply(p.clientReqId, async () => {
          await this.sessions.sendInput(p.sessionId, p.input);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.stop': {
        await this.tryReply(p.clientReqId, async () => {
          await this.sessions.stop(p.sessionId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.delete': {
        await this.tryReply(p.clientReqId, async () => {
          // Idempotent, unlike session.stop: the target is usually cold or already deleted by
          // another client. Provider-local history stays untouched, so session.import still works.
          await this.sessions.delete(p.sessionId);
          this.sendSuccess(p.clientReqId);
        });
        break;
      }
      case 'session.list': {
        const sessions = this.sessions.list();
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
          await this.records.importRecord(record);
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
          await this.sessions.startLive(p.clientReqId, record, (adapter) =>
            this.history.resume(adapter, p.historyId, startOpts),
          );
          if (startOpts.cwd) this.workspaces.touch(startOpts.cwd);
        });
        break;
      }
      case 'agent-runtime.list': {
        // Held until the boot probe lands (CODE-225): a pre-probe snapshot reads as every agent
        // missing, and the Download card is a consent surface — transient ignorance cannot show it.
        this.runtimes.serve((runtimes) => {
          this.transport.send(
            createWireMessage({
              kind: 'agent-runtime.listed',
              replyTo: p.clientReqId,
              runtimes,
            }),
          );
        });
        break;
      }
      case 'asset.list': {
        this.assets.list(p.clientReqId);
        break;
      }
      case 'asset.ensure': {
        this.assets.ensure(p.clientReqId, p.id);
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
      case 'script.list':
      case 'script.start':
      case 'script.stop': {
        await this.scriptRequests.handle(p);
        break;
      }
      case 'artifact.host':
      case 'artifact.revoke': {
        await this.artifactRequests.handle(p);
        break;
      }
      case 'schedule.create':
      case 'schedule.update':
      case 'schedule.delete':
      case 'schedule.pause':
      case 'schedule.resume':
      case 'schedule.run-once':
      case 'schedule.list':
      case 'schedule.runs.list':
      case 'loop.start':
      case 'loop.stop':
      case 'loop.delete':
      case 'loop.list':
      case 'loop.inspect': {
        await this.automationRequests.handle(p);
        break;
      }
      case 'session.attach': {
        // The Hub has already attached this connection to the session before forwarding the frame.
        // Re-emit the buffered state that a history read cannot recover: live status (which gates
        // pending-ask cards and the Stop affordance), adapter capabilities and approval policy,
        // the latest command catalog, and live permission/question state. Unresolved asks replay
        // their request; settled asks replay only their outcome so old cards cannot enter a later
        // turn. Clients fold this state idempotently and dedupe asks by requestId.
        this.sessions.replay(p.sessionId);
        break;
      }
      case 'session.detach': {
        // No-op in the Engine: the Hub already removed this connection's session subscription.
        break;
      }
      case 'terminal.open':
      case 'terminal.list':
      case 'terminal.attach':
      case 'terminal.detach':
      case 'terminal.input':
      case 'terminal.ack':
      case 'terminal.resize':
      case 'terminal.close': {
        await this.terminalRequests.handle(p);
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
    await this.sessions.shutdown();
    this.scripts?.shutdown();
    this.terminals?.closeAll();
    this.logins?.closeAll();
    await this.translator?.closeAll();
    this.assets.close();
    this.transport.close();
  }

  private nextSessionId(): SessionId {
    this.seq += 1;
    return `sess-${Date.now().toString(36)}-${this.seq.toString(36)}` as SessionId;
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
        await this.sessions.startLive(undefined, record, (adapter) => adapter.start(startOpts));
        if (startOpts.cwd) this.workspaces.touch(startOpts.cwd);
        return record.sessionId;
      },
      hasRecord: (sessionId) => this.records.has(sessionId),
      isBusy: (sessionId) => this.sessions.isBusy(sessionId),
      ensureLive: async (sessionId) => {
        if (this.sessions.has(sessionId)) return;
        await this.resumeSessionById(undefined, sessionId);
      },
      makeUnattended: (sessionId) => this.sessions.makeUnattended(sessionId),
      prompt: (sessionId, text, opts) => this.sessions.prompt(sessionId, text, opts),
      stopSession: (sessionId) => this.sessions.stopIfLive(sessionId),
    };
  }

  /**
   * Wake a cold session in place under the same Link Code id. Shared by the `session.resume` wire
   * handler (which passes its `clientReqId` so the orchestrator echoes `session.started`) and the
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
    const historyId = this.records.historyId(sessionId);
    const startOpts = await this.resolveStartOptions({ kind: record.kind, cwd: record.cwd });
    record.runs.push({ historyId, startedAt: Date.now() });
    await this.sessions.startLive(replyTo, record, (adapter) =>
      historyId === undefined
        ? adapter.start(startOpts)
        : this.history.resume(adapter, historyId, startOpts),
    );
    // Same contract as session.start / history.resume: waking a session (re)registers its directory,
    // so imported records and roots archived since still pass the file.suggest workspace check once
    // their session is live again.
    if (record.cwd) this.workspaces.touch(record.cwd);
  }

  private async tryReply(replyTo: string, fn: () => Promise<void>): Promise<void> {
    await this.responder.tryReply(replyTo, fn);
  }

  private sendFailure(replyTo: string, err: unknown): void {
    this.responder.sendFailure(replyTo, err);
  }

  private sendSuccess(replyTo: string): void {
    this.responder.sendSuccess(replyTo);
  }
}
