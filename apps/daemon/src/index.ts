import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import * as OtelResource from '@effect/opentelemetry/Resource';
import { NodeRuntime } from '@effect/platform-node';
import { agentRuntimeProber } from '@linkcode/agent-adapter';
import { AssetManager } from '@linkcode/assets';
import {
  EngineLive,
  EngineService,
  makeEngineInfrastructureLayer,
  PreviewRouteRegistry,
  SimulatorConsentService,
  SimulatorService,
} from '@linkcode/engine';
import type { DaemonIdentity, DaemonListenerInfo, DaemonRuntimeInfo } from '@linkcode/schema';
import {
  DAEMON_EXIT_ALREADY_RUNNING,
  ManagedAgentAssetNameSchema,
  managedAgentAssetId,
  managedToolAssetId,
  WIRE_PROTOCOL_VERSION,
} from '@linkcode/schema';
import { SimSidecarClient } from '@linkcode/sim';
import { createWireMessage } from '@linkcode/transport';
import { Hub } from '@linkcode/transport/server';
import * as Sentry from '@sentry/node';
import type { Runtime } from 'effect';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { createAiGatewaySidecar } from './ai-gateway';
import { installAsarSpawnFix } from './asar-spawn';
import { adoptLegacyDeviceKeyFile } from './cloud/device-key';
import { runLoginCommand, runLogoutCommand } from './cloud/login';
import { startCloudUplink } from './cloud/uplink';
import type { DaemonConfig } from './config';
import {
  chatWorkspaceRoot,
  daemonChannel,
  daemonProfile,
  databasePath,
  loadConfig,
  saveSimulatorConsent,
  worktreeRoot,
} from './config';
import { DaemonLoggerLive, logger } from './logger';
import { createLoopStore } from './loop-store';
import { agentsToRefresh, consentedManagedAgents } from './managed-agent-refresh';
import { daemonStateDir } from './paths';
import { createProviderConfigStore } from './provider-store';
import { resolveSidecarPath, SidecarPtyBackend } from './pty/sidecar';
import { createResourceStore } from './resource-store';
import {
  DaemonAlreadyRunningError,
  findRunningDaemon,
  listenWithPortHunt,
  removeRuntimeFile,
  writeRuntimeFile,
} from './runtime';
import { createScheduleStore } from './schedule-store';
import { secretVault } from './secrets';
import { createSessionStore } from './session-store';
import { resolveSimSidecarPath } from './sim/backend';
import { SimulatorMcpEndpoint } from './sim/mcp-endpoint';
import { createWorkspaceStore } from './workspace-store';
import { createWorktreeStore } from './worktree-store';

// State is untrustworthy after an uncaught exception — die rather than serve from unknown state.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});

/** How long a graceful drain may run after the first signal before the process force-exits. */
const DRAIN_TIMEOUT_MS = 10000;

/** Boot-wide values; acquiring it also enforces one-daemon-per-profile. */
class Shared extends Context.Service<
  Shared,
  {
    readonly config: DaemonConfig;
    readonly identity: DaemonIdentity;
    readonly hub: Hub;
    readonly previewRoutes: PreviewRouteRegistry;
  }
>()('daemon/Shared') {}

class BoundListeners extends Context.Service<BoundListeners, readonly DaemonListenerInfo[]>()(
  'daemon/BoundListeners',
) {}

function finalize(run: () => void | Promise<void>): Effect.Effect<void> {
  return Effect.tryPromise({ try: async () => run(), catch: (cause) => cause }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError(
        'Error during shutdown',
        { operation: 'shutdown.finalize' },
        Cause.squash(cause),
      ),
    ),
  );
}

// Explicit process.exit: utilityProcess IPC keeps the event loop alive, preventing natural exit.
const teardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isSuccess(exit)) {
    onExit(0);
    return;
  }
  // A signal interrupted the root fiber and the drain finished — the graceful path.
  if (Cause.hasInterruptsOnly(exit.cause)) {
    onExit(0);
    return;
  }
  const failure = Cause.findErrorOption(exit.cause);
  if (Option.isSome(failure) && failure.value instanceof DaemonAlreadyRunningError) {
    // Already logged at the failure site (gate or port hunt).
    onExit(DAEMON_EXIT_ALREADY_RUNNING);
    return;
  }
  logger.fatal({ err: Cause.squash(exit.cause) }, 'Daemon failed');
  onExit(1);
};

/** Link Code daemon — local host process: Engine behind a fan-out Hub, serving agents to clients. */
async function main(): Promise<void> {
  const profile = daemonProfile();
  const channel = daemonChannel();

  // The one place the vault is constructed (CODE-371): every module that needs a secret takes it as a
  // parameter and opens its own namespace, so no subsystem reaches the store by import and tests can
  // hand over an in-memory one. Resolved after the universe is known, never at module load.
  const vault = secretVault();

  const command = process.argv[2];
  if (command === 'login') return runLoginCommand(vault);
  if (command === 'logout') return runLogoutCommand(vault);

  installAsarSpawnFix();

  const SharedLive = Layer.effect(
    Shared,
    Effect.gen(function* () {
      const config = loadConfig(vault);
      // Sweep credentials an older daemon left in the clear. loadConfig has already moved
      // config.json's; the device key has no reader at boot, so it is swept explicitly (CODE-371).
      adoptLegacyDeviceKeyFile(vault);
      const running = yield* Effect.promise(findRunningDaemon);
      if (running) {
        const urls = running.listeners.map((listener) => listener.url).join(', ');
        yield* Effect.logWarning('Daemon already running', {
          operation: 'daemon.start',
          pid: running.pid,
        });
        yield* Effect.fail(new DaemonAlreadyRunningError(running, urls));
      }
      const identity: DaemonIdentity = {
        name: 'linkcode-daemon',
        pid: process.pid,
        startedAt: Date.now(),
        wireProtocolVersion: WIRE_PROTOCOL_VERSION,
        ...(profile !== undefined && { profile }),
        // Absent means release on the wire, so only development needs stating — this keeps a
        // release daemon's identity and runtime.json byte-identical to pre-split ones.
        ...(channel !== 'release' && { channel }),
      };
      const hub = new Hub();
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => Sentry.close(DRAIN_TIMEOUT_MS)).pipe(Effect.ignore),
      );
      yield* Effect.addFinalizer(() => finalize(() => hub.close()));
      const previewRoutes = new PreviewRouteRegistry();
      return { config, identity, hub, previewRoutes };
    }),
  );

  const EngineSubsystemLive = Layer.unwrap(
    Effect.gen(function* () {
      const { config, hub, previewRoutes } = yield* Shared;
      const store = createProviderConfigStore(
        vault,
        config.providers ?? {},
        config.accounts ?? [],
        config.customMcpServers ?? [],
      );
      const assets = new AssetManager();
      const consentedAgents = consentedManagedAgents(assets);
      const gc = assets.gcAtBoot();
      if (gc.removed.length > 0) {
        yield* Effect.logInfo('Removed superseded managed assets', {
          operation: 'asset.gc',
        });
      }
      if (gc.skipped.length > 0) {
        yield* Effect.logWarning('Skipped managed asset removal', {
          operation: 'asset.gc',
        });
      }
      agentRuntimeProber.setManagedResolver((kind) => {
        const name = ManagedAgentAssetNameSchema.safeParse(kind);
        return name.success ? assets.managedBinary(managedAgentAssetId(name.data)) : undefined;
      });
      agentRuntimeProber.setManagedEntryResolver((kind) => {
        const name = ManagedAgentAssetNameSchema.safeParse(kind);
        if (!name.success) return;
        const id = managedAgentAssetId(name.data);
        const path = assets.managedEntry(id);
        const version = assets.wantedVersionOf(id);
        return path && version ? { path, version } : undefined;
      });
      // Not awaited: CLI probes are slow; listeners must bind without waiting.
      const agentRuntimesReady = agentRuntimeProber.collect();
      const simSidecarPath = resolveSimSidecarPath();
      const simulators = simSidecarPath
        ? new SimulatorService(new SimSidecarClient(simSidecarPath))
        : undefined;
      const simulatorConsent = new SimulatorConsentService({
        load: () => Promise.resolve(config.simulatorConsent),
        save: (state) => Promise.resolve(saveSimulatorConsent(state)),
      });
      yield* Effect.promise(() => simulatorConsent.init());
      simulatorConsent.setHooks({
        ask(sessionId, udid, tool) {
          if (hub.size === 0) return false;
          hub.send(
            createWireMessage({ kind: 'simulator.consent.required', sessionId, udid, tool }),
          );
          return true;
        },
        publish(state) {
          hub.send(createWireMessage({ kind: 'simulator.consent.changed', state }));
        },
      });
      const simulatorMcp = simulators
        ? yield* Effect.promise(() =>
            SimulatorMcpEndpoint.create(simulators, simulatorConsent, {
              activity(activity) {
                hub.send(createWireMessage({ kind: 'simulator.activity', ...activity }));
              },
              devicesChanged(devices) {
                hub.send(createWireMessage({ kind: 'simulator.devices.changed', devices }));
              },
            }),
          )
        : undefined;
      if (simulatorMcp) {
        yield* Effect.addFinalizer(() => finalize(() => simulatorMcp.close()));
      }
      const EngineInfrastructureLive = makeEngineInfrastructureLayer(hub, {
        providerStore: store,
        ptyBackend: new SidecarPtyBackend(resolveSidecarPath()),
        simulators,
        simulatorMcp,
        simulatorConsent,
        sessionStore: createSessionStore(databasePath()),
        resourceStore: createResourceStore(databasePath()),
        stateDir: daemonStateDir(),
        // After sessionStore so its migration-ledger reconcile runs before this store migrates.
        scheduleStore: createScheduleStore(databasePath()),
        loopStore: createLoopStore(databasePath()),
        workspaceStore: createWorkspaceStore(databasePath()),
        worktreeStore: createWorktreeStore(databasePath()),
        worktreeRoot: worktreeRoot(),
        previewRoutes,
        browserToolsEnabled: process.env.LINKCODE_BROWSER_TOOLS === '1',
        agentRuntimesReady,
        assets,
        // Lets the engine refresh (and push) the runtime snapshot after a managed install lands.
        collectAgentRuntimes: () => agentRuntimeProber.collect(),
        // Spawn path for an interactive claude-code/codex login (managed/detected/SDK binary).
        resolveLoginBinary: (agent) =>
          agent === 'claude-code' || agent === 'codex'
            ? agentRuntimeProber.loginBinaryPath(agent)
            : undefined,
        // Local Anthropic⇄OpenAI translation for cross-protocol accounts (arcboxlabs/aigateway).
        // The binary installs on demand from the asset store; LINKCODE_AIGATEWAY_PATH overrides.
        translator: createAiGatewaySidecar({
          ensureBinary: async () => (await assets.ensure(managedToolAssetId('aigateway')))?.path,
        }),
      });
      const EngineReady = Layer.effectDiscard(
        Effect.gen(function* () {
          const engine = yield* EngineService;
          void agentRuntimesReady
            .then((agentRuntimes) => {
              const refreshable = agentsToRefresh(consentedAgents, agentRuntimes, assets);
              for (let i = 0, len = refreshable.length; i < len; i++) {
                const kind = refreshable[i];
                void assets
                  .ensure(managedAgentAssetId(kind))
                  .catch((err) => {
                    logger.warn(
                      { err, agentKind: kind, operation: 'asset.ensure' },
                      'Managed agent install failed',
                    );
                  })
                  .then((installed) => {
                    if (installed) {
                      logger.info(
                        { agentKind: kind, operation: 'asset.ensure' },
                        'Managed agent runtime ready',
                      );
                    }
                  });
              }
            })
            .catch((err) => {
              logger.warn({ err, operation: 'agent.probe' }, 'Boot agent probe failed');
            });
          // Runs before any listener binds, so `workspace.list` always includes the chat workspace.
          yield* engine.ensureChatWorkspace(chatWorkspaceRoot());
        }),
      );
      const EngineRuntimeLive = EngineLive.pipe(Layer.provide(EngineInfrastructureLive));
      return EngineReady.pipe(Layer.provideMerge(EngineRuntimeLive));
    }),
  );

  const ListenersLive = Layer.effect(
    BoundListeners,
    Effect.gen(function* () {
      const { config, identity, hub, previewRoutes } = yield* Shared;
      // Ordering only: listeners must not bind before the engine is started and the chat
      // workspace exists.
      yield* EngineService;
      // Listeners hunt concurrently; a transient collision between two of our own hunts resolves
      // itself because listenWithPortHunt treats an occupant with our pid as "keep hunting".
      return yield* Effect.forEach(
        config.listeners,
        (listener) =>
          Effect.gen(function* () {
            const { server, url, port } = yield* Effect.acquireRelease(
              Effect.tryPromise({
                try: () => listenWithPortHunt(listener, identity, previewRoutes),
                catch: (err) =>
                  err instanceof DaemonAlreadyRunningError
                    ? err
                    : new Error(extractErrorMessage(err) ?? 'listener failed to bind'),
              }),
              (bound) => finalize(() => bound.server.close()),
            );
            // Preview URLs carry the first bound port; every listener proxies the same table.
            previewRoutes.proxyPort ??= port;
            server.onConnection((conn) => {
              hub.addConnection(conn);
              conn.onClose(() => hub.removeConnection(conn));
            });
            yield* Effect.logInfo('Daemon listener bound', {
              operation: 'listener.bind',
              listenerType: listener.type,
              url,
            });
            return { type: listener.type, url } satisfies DaemonListenerInfo;
          }),
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.tapError((err) =>
          Effect.sync(() => {
            if (err instanceof DaemonAlreadyRunningError) {
              logger.warn(
                { operation: 'listener.bind' },
                extractErrorMessage(err) ?? 'Daemon already running',
              );
            }
          }),
        ),
      );
    }),
  );

  // Advertise local discovery only after every listener is bound, then bring up the cloud uplink.
  // LIFO teardown stops the uplink first and removes runtime.json before listeners close, so
  // clients stop discovering a daemon that is draining.
  const LifecycleLive = Layer.effectDiscard(
    Effect.gen(function* () {
      const { identity, hub } = yield* Shared;
      const bound = yield* BoundListeners;
      const info: DaemonRuntimeInfo = { ...identity, listeners: [...bound] };
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          writeRuntimeFile(info);
        }),
        () => finalize(removeRuntimeFile),
      );
      yield* Effect.acquireRelease(
        Effect.sync(() => startCloudUplink(hub, vault)),
        (stop) => finalize(stop),
      );
    }),
  );

  const MainLive = LifecycleLive.pipe(
    Layer.provideMerge(ListenersLive),
    Layer.provideMerge(EngineSubsystemLive),
    Layer.provideMerge(SharedLive),
    Layer.provide(DaemonLoggerLive),
    Layer.provide(
      OtelTracer.layerGlobal.pipe(
        Layer.provide(OtelResource.layer({ serviceName: 'linkcode-daemon' })),
      ),
    ),
  );

  // runMain turns SIGINT/SIGTERM into fiber interruption but has no escalation of its own: a
  // hung finalizer would leave an unkillable-by-TERM orphan. First signal arms a drain deadline;
  // a second signal force-exits immediately.
  let signalCount = 0;
  const escalate = (): void => {
    signalCount += 1;
    if (signalCount > 1) {
      logger.fatal({ operation: 'shutdown' }, 'Second signal during shutdown; forcing exit');
      process.exit(1);
    }
    const deadline = setTimeout(() => {
      logger.fatal({ operation: 'shutdown' }, 'Shutdown drain timed out; forcing exit');
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    deadline.unref();
  };
  process.on('SIGINT', escalate);
  process.on('SIGTERM', escalate);

  NodeRuntime.runMain(Layer.launch(MainLive), { teardown, disableErrorReporting: true });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Daemon failed before runtime launch');
  process.exit(1);
});
