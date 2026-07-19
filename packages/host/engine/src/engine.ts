import { createAdapter } from '@linkcode/agent-adapter';
import type { WorkspaceRecord } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { AgentLoginService } from './agent/login-service';
import { InMemoryProviderConfigStore } from './agent/provider-config';
import { AgentRequestHandler } from './agent/request-handler';
import { AgentRuntimeService } from './agent/runtime-service';
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
export interface EngineRuntime {
  readonly start: () => Promise<void>;
  readonly ensureChatWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  readonly stop: () => Promise<void>;
}

export function createEngineRuntime(transport: Transport, deps: EngineDeps = {}): EngineRuntime {
  const responder = new WireResponder(transport);
  const factory = deps.factory ?? createAdapter;
  const providerStore = deps.providerStore ?? new InMemoryProviderConfigStore();
  const records = new SessionRecordRegistry(deps.sessionStore ?? new InMemorySessionStore());
  const history = new HistoryService(factory);
  const runtimes = new AgentRuntimeService({
    initial: deps.agentRuntimes,
    ready: deps.agentRuntimesReady,
    collect: deps.collectAgentRuntimes,
    onChanged(next) {
      transport.send(createWireMessage({ kind: 'agent-runtime.changed', runtimes: next }));
    },
    onError(message, error) {
      console.error(message, error);
    },
  });
  let terminals: TerminalService | undefined;
  const sessions = new SessionOrchestrator(transport, factory, records, runtimes, (sessionId) =>
    terminals?.killBySession(sessionId),
  );
  terminals = deps.ptyBackend
    ? new TerminalService(deps.ptyBackend, transport, (id) => sessions.has(id))
    : undefined;
  const terminalRequests = new TerminalRequestHandler(terminals, responder);
  const workspaces = new WorkspaceRegistry(deps.workspaceStore ?? new InMemoryWorkspaceStore());
  const workspaceRequests = new WorkspaceRequestHandler(transport, workspaces, responder);
  const gitRequests = new GitRequestHandler(transport, deps.git ?? new GitService(), responder);
  const fileRequests = new FileRequestHandler(
    transport,
    deps.fileSuggest ?? new FileSuggestService(),
    workspaces,
    responder,
  );
  const routes = deps.previewRoutes ?? new PreviewRouteRegistry();
  const scripts = terminals
    ? new ScriptService(transport, terminals, routes, (cwd) => workspaces.findByCwd(cwd)?.name)
    : undefined;
  const scriptRequests = new ScriptRequestHandler(transport, scripts, responder);
  const artifactRequests = new ArtifactRequestHandler(
    transport,
    new ArtifactHostService(routes),
    responder,
  );
  const translator = deps.translator;
  const startOptions = new SessionStartOptionsResolver(providerStore, translator);
  const sessionLifecycle = new SessionLifecycleService(
    sessions,
    records,
    history,
    startOptions,
    workspaces,
  );
  const sessionRequests = new SessionRequestHandler(
    transport,
    sessionLifecycle,
    sessions,
    responder,
  );
  const historyRequests = new HistoryRequestHandler(
    transport,
    history,
    sessionLifecycle,
    responder,
  );
  const scheduler = new ScheduleService(
    transport,
    deps.scheduleStore ?? new InMemoryScheduleStore(),
    sessionLifecycle.driver,
  );
  const loops = new LoopService(
    transport,
    deps.loopStore ?? new InMemoryLoopStore(),
    sessionLifecycle.driver,
  );
  const automationRequests = new AutomationRequestHandler(transport, scheduler, loops, responder);
  const assets = new ManagedAssetService(
    transport,
    deps.assets,
    () => {
      void runtimes.refresh();
    },
    responder,
  );
  const logins = deps.resolveLoginBinary
    ? new AgentLoginService(transport, deps.resolveLoginBinary, () => {
        void runtimes.refresh();
      })
    : undefined;
  const agentRequests = new AgentRequestHandler(
    transport,
    runtimes,
    assets,
    providerStore,
    logins,
    responder,
  );
  const requests = new WireRequestRouter(transport, {
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

  return {
    async start() {
      await records.load();
      await workspaces.start();
      // After the session records are loaded (the schedule orphan-sweep reads them) and before the
      // transport connects, so the first tick can't race an unconnected transport.
      await scheduler.start();
      // Loops don't resume across a restart; start() only sweeps interrupted loops to `stopped`.
      await loops.start();
      await transport.connect();
      transport.onMessage((msg) => {
        // Per-request failures already reply over the wire via tryReply; this is the last-resort
        // backstop for anything that throws before or outside that path (e.g. a malformed payload).
        requests.handle(msg).catch((err: unknown) => {
          console.error('Unhandled error while processing message:', err);
        });
      });
    },
    ensureChatWorkspace(cwd) {
      return workspaces.ensureChatWorkspace(cwd);
    },
    async stop() {
      // Stop launching new automation sessions before the session-teardown sweep runs.
      scheduler.shutdown();
      loops.shutdown();
      await sessions.shutdown();
      scripts?.shutdown();
      terminals?.closeAll();
      logins?.closeAll();
      await translator?.closeAll();
      assets.close();
      transport.close();
    },
  };
}
