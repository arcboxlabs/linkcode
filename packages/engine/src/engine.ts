import { createAdapter } from '@linkcode/agent-adapter';
import type { WorkspaceRecord } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { AgentLoginService } from './agent/login-service';
import { InMemoryProviderConfigStore } from './agent/provider-config';
import { AgentRequestHandler } from './agent/request-handler';
import { AgentRuntimeService } from './agent/runtime-service';
import type { TranslatorService } from './agent/translator';
import { ManagedAssetService } from './asset/service';
import {
  InMemoryLoopStore,
  InMemoryScheduleStore,
  LoopService,
  ScheduleService,
} from './automation';
import { AutomationRequestHandler } from './automation/request-handler';
import type { EngineDeps } from './deps';
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
import { InMemorySessionStore } from './session/session-store';
import { SessionStartOptionsResolver } from './session/start-options-resolver';
import { TerminalRequestHandler } from './terminal/request-handler';
import { TerminalService } from './terminal/service';
import { WireRequestRouter } from './wire/request-router';
import { WireResponder } from './wire/responder';
import { FileRequestHandler } from './workspace/file-request-handler';
import { FileSuggestService } from './workspace/file-suggest-service';
import { WorkspaceRequestHandler } from './workspace/request-handler';
import { WorkspaceRegistry } from './workspace/workspace-registry';
import { InMemoryWorkspaceStore } from './workspace/workspace-store';

/**
 * The local core engine — the "host" that runs the agents, carrier-agnostic
 * (docs/ARCHITECTURE.md#the-host-engine-adapters-abstraction, #core-principles).
 * Events broadcast to every attached client, so request/response control messages are correlated
 * by id: a request's `clientReqId` echoes back as `replyTo` on the matching reply.
 */
export class Engine {
  private readonly sessions: SessionOrchestrator;
  private readonly records: SessionRecordRegistry;
  private readonly terminals?: TerminalService;
  private readonly workspaces: WorkspaceRegistry;
  private readonly scripts?: ScriptService;
  private readonly scheduler: ScheduleService;
  private readonly loops: LoopService;
  private readonly assets: ManagedAssetService;
  private readonly logins?: AgentLoginService;
  private readonly translator?: TranslatorService;
  private readonly requests: WireRequestRouter;

  constructor(
    private readonly transport: Transport,
    deps: EngineDeps = {},
  ) {
    const responder = new WireResponder(transport);
    const factory = deps.factory ?? createAdapter;
    const providerStore = deps.providerStore ?? new InMemoryProviderConfigStore();
    this.records = new SessionRecordRegistry(deps.sessionStore ?? new InMemorySessionStore());
    const history = new HistoryService(factory);
    const runtimes = new AgentRuntimeService({
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
      runtimes,
      (sessionId) => this.terminals?.killBySession(sessionId),
    );
    this.terminals = deps.ptyBackend
      ? new TerminalService(deps.ptyBackend, transport, (id) => this.sessions.has(id))
      : undefined;
    const terminalRequests = new TerminalRequestHandler(this.terminals, responder);
    this.workspaces = new WorkspaceRegistry(deps.workspaceStore ?? new InMemoryWorkspaceStore());
    const workspaceRequests = new WorkspaceRequestHandler(transport, this.workspaces, responder);
    const gitRequests = new GitRequestHandler(transport, deps.git ?? new GitService(), responder);
    const fileRequests = new FileRequestHandler(
      transport,
      deps.fileSuggest ?? new FileSuggestService(),
      this.workspaces,
      responder,
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
    const scriptRequests = new ScriptRequestHandler(transport, this.scripts, responder);
    const artifactRequests = new ArtifactRequestHandler(
      transport,
      new ArtifactHostService(routes),
      responder,
    );
    this.translator = deps.translator;
    const startOptions = new SessionStartOptionsResolver(providerStore, this.translator);
    const sessionLifecycle = new SessionLifecycleService(
      this.sessions,
      this.records,
      history,
      startOptions,
      this.workspaces,
    );
    const sessionRequests = new SessionRequestHandler(
      transport,
      sessionLifecycle,
      this.sessions,
      responder,
    );
    const historyRequests = new HistoryRequestHandler(
      transport,
      history,
      sessionLifecycle,
      responder,
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
    const automationRequests = new AutomationRequestHandler(
      transport,
      this.scheduler,
      this.loops,
      responder,
    );
    this.assets = new ManagedAssetService(transport, deps.assets, () => {
      void runtimes.refresh();
    });
    this.logins = deps.resolveLoginBinary
      ? new AgentLoginService(transport, deps.resolveLoginBinary, () => {
          void runtimes.refresh();
        })
      : undefined;
    const agentRequests = new AgentRequestHandler(
      transport,
      runtimes,
      this.assets,
      providerStore,
      this.logins,
      responder,
    );
    this.requests = new WireRequestRouter(transport, {
      session: sessionRequests,
      history: historyRequests,
      agent: agentRequests,
      workspace: workspaceRequests,
      git: gitRequests,
      file: fileRequests,
      script: scriptRequests,
      artifact: artifactRequests,
      automation: automationRequests,
      terminal: terminalRequests,
    });
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
      this.requests.handle(msg).catch((err: unknown) => {
        console.error('Unhandled error while processing message:', err);
      });
    });
  }

  /** Ensure the daemon-owned chat workspace exists at `cwd` ({@link WorkspaceRegistry.ensureChatWorkspace}).
   * Called once by the daemon at startup, before any client can connect. */
  ensureChatWorkspace(cwd: string): Promise<WorkspaceRecord> {
    return this.workspaces.ensureChatWorkspace(cwd);
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
