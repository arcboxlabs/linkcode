import type { AdapterFactory } from '@linkcode/agent-adapter';
import { createAdapter } from '@linkcode/agent-adapter';
import type { AgentRuntimes, WireMessage, WorkspaceRecord } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { LoginBinaryResolver } from './agent/login-service';
import { AgentLoginService } from './agent/login-service';
import type { ProviderConfigStore } from './agent/provider-config';
import { InMemoryProviderConfigStore } from './agent/provider-config';
import { AgentRequestHandler } from './agent/request-handler';
import { AgentRuntimeService } from './agent/runtime-service';
import type { TranslatorService } from './agent/translator';
import type { AssetService } from './asset/service';
import { ManagedAssetService } from './asset/service';
import type { LoopStore, ScheduleStore } from './automation';
import {
  InMemoryLoopStore,
  InMemoryScheduleStore,
  LoopService,
  ScheduleService,
} from './automation';
import { AutomationRequestHandler } from './automation/request-handler';
import { GitService } from './git/git-service';
import { GitRequestHandler } from './git/request-handler';
import { ArtifactHostService } from './preview/artifact-host-service';
import { ArtifactRequestHandler } from './preview/request-handler';
import { PreviewRouteRegistry } from './preview/route-registry';
import { ScriptRequestHandler } from './scripts/request-handler';
import { ScriptService } from './scripts/script-service';
import { HistoryRequestHandler } from './session/history-request-handler';
import { HistoryService } from './session/history-service';
import { SessionLifecycleService } from './session/lifecycle-service';
import { SessionOrchestrator } from './session/orchestrator';
import { SessionRequestHandler } from './session/request-handler';
import { SessionRecordRegistry } from './session/session-record-registry';
import type { SessionStore } from './session/session-store';
import { InMemorySessionStore } from './session/session-store';
import { SessionStartOptionsResolver } from './session/start-options-resolver';
import type { PtyBackend } from './terminal/pty-backend';
import { TerminalRequestHandler } from './terminal/request-handler';
import { TerminalService } from './terminal/service';
import { WireResponder } from './wire/responder';
import { FileRequestHandler } from './workspace/file-request-handler';
import { FileSuggestService } from './workspace/file-suggest-service';
import { WorkspaceRequestHandler } from './workspace/request-handler';
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
  private readonly sessionRequests: SessionRequestHandler;
  private readonly records: SessionRecordRegistry;
  private readonly historyRequests: HistoryRequestHandler;
  private readonly terminals?: TerminalService;
  private readonly terminalRequests: TerminalRequestHandler;
  private readonly responder: WireResponder;
  private readonly workspaces: WorkspaceRegistry;
  private readonly workspaceRequests: WorkspaceRequestHandler;
  private readonly providerStore: ProviderConfigStore;
  private readonly gitRequests: GitRequestHandler;
  private readonly fileRequests: FileRequestHandler;
  private readonly scripts?: ScriptService;
  private readonly scriptRequests: ScriptRequestHandler;
  private readonly scheduler: ScheduleService;
  private readonly loops: LoopService;
  private readonly automationRequests: AutomationRequestHandler;
  private readonly artifactRequests: ArtifactRequestHandler;
  private readonly runtimes: AgentRuntimeService;
  private readonly assets: ManagedAssetService;
  private readonly logins?: AgentLoginService;
  private readonly agentRequests: AgentRequestHandler;
  private readonly translator?: TranslatorService;

  constructor(
    private readonly transport: Transport,
    deps: EngineDeps = {},
  ) {
    this.responder = new WireResponder(transport);
    const factory = deps.factory ?? createAdapter;
    this.providerStore = deps.providerStore ?? new InMemoryProviderConfigStore();
    this.records = new SessionRecordRegistry(deps.sessionStore ?? new InMemorySessionStore());
    const history = new HistoryService(factory);
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
    this.workspaceRequests = new WorkspaceRequestHandler(
      transport,
      this.workspaces,
      this.responder,
    );
    this.gitRequests = new GitRequestHandler(
      transport,
      deps.git ?? new GitService(),
      this.responder,
    );
    this.fileRequests = new FileRequestHandler(
      transport,
      deps.fileSuggest ?? new FileSuggestService(),
      this.workspaces,
      this.responder,
    );
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
    this.translator = deps.translator;
    const startOptions = new SessionStartOptionsResolver(this.providerStore, this.translator);
    const sessionLifecycle = new SessionLifecycleService(
      this.sessions,
      this.records,
      history,
      startOptions,
      this.workspaces,
    );
    this.sessionRequests = new SessionRequestHandler(
      transport,
      sessionLifecycle,
      this.sessions,
      this.responder,
    );
    this.historyRequests = new HistoryRequestHandler(
      transport,
      history,
      sessionLifecycle,
      this.responder,
    );
    this.scheduler = new ScheduleService(
      transport,
      deps.scheduleStore ?? new InMemoryScheduleStore(),
      sessionLifecycle.driver,
    );
    this.loops = new LoopService(
      transport,
      deps.loopStore ?? new InMemoryLoopStore(),
      sessionLifecycle.driver,
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
    this.logins = deps.resolveLoginBinary
      ? new AgentLoginService(transport, deps.resolveLoginBinary, () => {
          void this.runtimes.refresh();
        })
      : undefined;
    this.agentRequests = new AgentRequestHandler(
      transport,
      this.runtimes,
      this.assets,
      this.providerStore,
      this.logins,
      this.responder,
    );
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

  private async handle(msg: WireMessage): Promise<void> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.start':
      case 'agent.input':
      case 'session.stop':
      case 'session.delete':
      case 'session.list':
      case 'session.resume':
      case 'session.import':
      case 'session.attach':
      case 'session.detach': {
        await this.sessionRequests.handle(p);
        break;
      }
      case 'history.list':
      case 'history.read':
      case 'history.resume': {
        await this.historyRequests.handle(p);
        break;
      }
      case 'agent-runtime.list':
      case 'asset.list':
      case 'asset.ensure':
      case 'config.get':
      case 'config.set': {
        await this.agentRequests.handle(p);
        break;
      }
      case 'workspace.list':
      case 'workspace.register':
      case 'workspace.update':
      case 'workspace.archive': {
        await this.workspaceRequests.handle(p);
        break;
      }
      case 'git.status.get':
      case 'git.pr_status.get':
      case 'git.diff.get': {
        await this.gitRequests.handle(p);
        break;
      }
      case 'file.read':
      case 'file.list':
      case 'file.suggest': {
        await this.fileRequests.handle(p);
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
      case 'agent-login.start':
      case 'agent-login.submit-code':
      case 'agent-login.cancel': {
        await this.agentRequests.handle(p);
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
}
