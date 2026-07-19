import { createAdapter } from '@linkcode/agent-adapter';
import type { WorkspaceRecord } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { Scope } from 'effect';
import { Cause, Effect, FiberSet } from 'effect';
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
import type { EngineFailure, OperationSubsystem } from './failure';
import { toOperationFailure } from './failure';
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
  readonly start: Effect.Effect<void, EngineFailure, Scope.Scope>;
  readonly ensureChatWorkspace: (cwd: string) => Effect.Effect<WorkspaceRecord, EngineFailure>;
  readonly stop: Effect.Effect<void>;
}

export const createEngineRuntime = Effect.fn('Engine.create')(function* (
  transport: Transport,
  deps: EngineDeps = {},
) {
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
  const git = deps.git ?? (yield* GitService.make());
  const gitRequests = new GitRequestHandler(transport, git, responder);
  const fileSuggest = deps.fileSuggest ?? (yield* FileSuggestService.make());
  const fileRequests = new FileRequestHandler(transport, fileSuggest, workspaces, responder);
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
    providerStore,
    logins,
    responder,
  );
  const requests = new WireRequestRouter(transport, {
    session: sessionRequests,
    history: historyRequests,
    agent: agentRequests,
    asset: assets,
    workspace: workspaceRequests,
    git: gitRequests,
    file: fileRequests,
    script: scriptRequests,
    artifact: artifactRequests,
    automation: automationRequests,
    terminal: terminalRequests,
  });
  let unsubscribeRequests: Unsubscribe | undefined;

  return {
    start: Effect.gen(function* () {
      yield* tryOperation('store', 'session-records.load', 'Failed to load session records', () =>
        records.load(),
      );
      yield* tryOperation('store', 'workspaces.load', 'Failed to load workspaces', () =>
        workspaces.start(),
      );
      // After the session records are loaded (the schedule orphan-sweep reads them) and before the
      // transport connects, so the first tick can't race an unconnected transport.
      yield* tryOperation('store', 'schedules.recover', 'Failed to recover schedules', () =>
        scheduler.start(),
      );
      // Loops don't resume across a restart; start() only sweeps interrupted loops to `stopped`.
      yield* tryOperation('store', 'loops.recover', 'Failed to recover loops', () => loops.start());
      yield* trySyncOperation(
        'asset',
        'assets.subscribe',
        'Failed to subscribe to asset events',
        () => assets.start(),
      );
      yield* tryOperation('transport', 'transport.connect', 'Failed to connect transport', () =>
        transport.connect(),
      );
      const runRequest = yield* FiberSet.makeRuntime<never, void, never>();
      yield* trySyncOperation(
        'transport',
        'transport.subscribe',
        'Failed to subscribe to transport messages',
        () => {
          unsubscribeRequests = transport.onMessage((msg) => {
            runRequest(
              requests
                .handle(msg)
                .pipe(
                  Effect.catchCause((cause) =>
                    Cause.hasInterruptsOnly(cause)
                      ? Effect.void
                      : Effect.logError(
                          'Unhandled error while processing engine request',
                          Cause.squash(cause),
                        ),
                  ),
                ),
            );
          });
        },
      );
    }).pipe(Effect.withSpan('Engine.start')),
    ensureChatWorkspace: Effect.fn('Engine.ensureChatWorkspace')(function* (cwd: string) {
      return yield* tryOperation(
        'store',
        'workspace.ensure-chat',
        'Failed to ensure the chat workspace',
        () => workspaces.ensureChatWorkspace(cwd),
      );
    }),
    stop: Effect.gen(function* () {
      // Stop launching new automation sessions before the session-teardown sweep runs. Each step
      // logs and continues so one broken collaborator cannot leak every resource after it.
      yield* finalize('transport.unsubscribe', () => {
        unsubscribeRequests?.();
        unsubscribeRequests = undefined;
      });
      yield* finalize('schedules.shutdown', () => scheduler.shutdown());
      yield* finalize('loops.shutdown', () => loops.shutdown());
      yield* finalize('sessions.shutdown', () => sessions.shutdown());
      yield* finalize('scripts.shutdown', () => scripts?.shutdown());
      yield* finalize('terminals.shutdown', () => terminals?.closeAll());
      yield* finalize('agent-login.shutdown', () => logins?.closeAll());
      yield* finalize('translator.shutdown', () => translator?.closeAll());
      yield* finalize('assets.shutdown', () => assets.close());
      yield* finalize('transport.close', () => transport.close());
    }).pipe(Effect.withSpan('Engine.stop')),
  };
});

function tryOperation<A>(
  subsystem: OperationSubsystem,
  operation: string,
  publicMessage: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, EngineFailure> {
  return Effect.tryPromise({
    try: () => run(),
    catch: (cause) => toOperationFailure(cause, { subsystem, operation, publicMessage }),
  });
}

function trySyncOperation<A>(
  subsystem: OperationSubsystem,
  operation: string,
  publicMessage: string,
  run: () => A,
): Effect.Effect<A, EngineFailure> {
  return Effect.try({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem, operation, publicMessage }),
  });
}

function finalize(operation: string, run: () => void | PromiseLike<void>): Effect.Effect<void> {
  return Effect.tryPromise({ try: async () => run(), catch: (cause) => cause }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError('Engine shutdown step failed', { operation }, Cause.squash(cause)),
    ),
  );
}
