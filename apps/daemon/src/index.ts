import { NodeRuntime } from '@effect/platform-node';
import { agentRuntimeProber } from '@linkcode/agent-adapter';
import { AssetManager } from '@linkcode/assets';
import { Engine, PreviewRouteRegistry } from '@linkcode/engine';
import type { DaemonIdentity, DaemonListenerInfo, DaemonRuntimeInfo } from '@linkcode/schema';
import { DAEMON_EXIT_ALREADY_RUNNING } from '@linkcode/schema';
import { Hub } from '@linkcode/transport/server';
import type { Runtime } from 'effect';
import { Cause, Context, Effect, Exit, Layer, Option } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { createAiGatewaySidecar } from './ai-gateway';
import { installAsarSpawnFix } from './asar-spawn';
import type { DaemonConfig } from './config';
import { chatWorkspaceRoot, daemonProfile, databasePath, loadConfig } from './config';
import { runLoginCommand, runLogoutCommand } from './hq/login';
import { startHqUplink } from './hq/uplink';
import { agentsToRefresh, consentedManagedAgents } from './managed-agent-refresh';
import { createProviderConfigStore } from './provider-store';
import { resolveSidecarPath, SidecarPtyBackend } from './pty/sidecar';
import {
  DaemonAlreadyRunningError,
  findRunningDaemon,
  listenWithPortHunt,
  removeRuntimeFile,
  writeRuntimeFile,
} from './runtime';
import { createSessionStore } from './session-store';
import { createWorkspaceStore } from './workspace-store';

// After an uncaught exception the process state (live sessions, mid-writes) is untrustworthy —
// die loudly rather than keep serving clients from an unknown state.
process.on('uncaughtException', (err) => {
  console.error('[linkcode/daemon] uncaught exception:', err);
  process.exit(1);
});

// An unhandled rejection is scoped to one async operation — the rest of the daemon stays
// coherent, so log instead of exiting. Reaching here means a fire-and-forget path missed its
// `.catch`; fix that path.
process.on('unhandledRejection', (reason) => {
  console.error('[linkcode/daemon] unhandled rejection:', reason);
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

class EngineHandle extends Context.Service<EngineHandle, Engine>()('daemon/Engine') {}

class BoundListeners extends Context.Service<BoundListeners, readonly DaemonListenerInfo[]>()(
  'daemon/BoundListeners',
) {}

// A failing finalizer must not change the shutdown outcome; log and move on.
function finalize(run: () => void | Promise<void>): Effect.Effect<void> {
  return Effect.promise(async () => {
    try {
      await run();
    } catch (err) {
      console.error('[linkcode/daemon] error during shutdown:', err);
    }
  });
}

// Explicit exits everywhere, not exitCode+return: under utilityProcess the parent IPC channel
// keeps the event loop alive forever, so a natural exit never happens and the supervisor never
// hears it. runMain's onExit only skips process.exit for a signal-less code 0, which the
// never-completing program cannot produce.
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
  console.error('[linkcode/daemon] fatal:', Cause.squash(exit.cause));
  onExit(1);
};

/**
 * Link Code daemon — the standalone local host process: one shared `Engine` behind a fan-out
 * `Hub`, exposing configured listeners to clients. Real agents live here — they spawn CLI
 * subprocesses and hold credentials, so they cannot run inside a browser tab.
 *
 * Boot/shutdown is an Effect layer graph (CODE-244): acquisition order Shared → Engine →
 * Listeners → lifecycle (runtime file, then uplink), finalizers in reverse. Signals interrupt
 * the root fiber at any boot phase, unwinding exactly the layers that were acquired.
 */
async function main(): Promise<void> {
  // Resolved before anything (subcommands included) touches state paths: an invalid
  // LINKCODE_PROFILE must abort here, not mid-command or as a default-profile daemon.
  const profile = daemonProfile();

  // Subcommands run and exit instead of booting the host (a running daemon
  // picks the new sign-in state up on its next restart).
  const command = process.argv[2];
  if (command === 'login') return runLoginCommand();
  if (command === 'logout') return runLogoutCommand();

  // Before the engine starts: agent adapters spawn vendored CLI binaries that resolve inside the
  // desktop app's asar (no-op outside Electron — see asar-spawn.ts).
  installAsarSpawnFix();

  const SharedLive = Layer.effect(
    Shared,
    Effect.gen(function* () {
      const config = loadConfig();
      // One daemon per profile — a second instance would share this profile's daemon.db and split
      // sessions. Daemons of other profiles live in sibling state dirs and are not visible here.
      const running = yield* Effect.promise(findRunningDaemon);
      if (running) {
        const urls = running.listeners.map((listener) => listener.url).join(', ');
        console.error(`[linkcode/daemon] already running (pid ${running.pid}) at ${urls}`);
        yield* Effect.fail(new DaemonAlreadyRunningError(running, urls));
      }
      const identity: DaemonIdentity = {
        name: 'linkcode-daemon',
        pid: process.pid,
        startedAt: Date.now(),
        ...(profile !== undefined && { profile }),
      };
      const hub = new Hub();
      // Engine.stop() also closes the hub via transport.close(); Hub.close is idempotent, so the
      // late double-close here matches the old stopAll behavior.
      yield* Effect.addFinalizer(() => finalize(() => hub.close()));
      // Written by the engine's script service, read by every listener's reverse proxy. Preview
      // traffic bypasses daemon auth by decision — the loopback bind is the boundary; remote
      // exposure is the tunnel's job.
      const previewRoutes = new PreviewRouteRegistry();
      return { config, identity, hub, previewRoutes };
    }),
  );

  const EngineLive = Layer.effect(
    EngineHandle,
    Effect.gen(function* () {
      const { config, hub, previewRoutes } = yield* Shared;
      const store = createProviderConfigStore(config.providers ?? {}, config.accounts ?? []);
      // Managed assets (CODE-111): GC superseded versions before anything can spawn, then feed the
      // store into spawn resolution — managed wins over detected as soon as an install lands.
      const assets = new AssetManager();
      // Prior managed install = standing consent to keep that agent current (CODE-221). Snapshot
      // before GC removes superseded versions.
      const consentedAgents = consentedManagedAgents(assets);
      const gc = assets.gcAtBoot();
      if (gc.removed.length > 0) {
        console.log(`[linkcode/daemon] assets gc: removed ${gc.removed.join(', ')}`);
      }
      if (gc.skipped.length > 0) {
        console.warn(`[linkcode/daemon] assets gc: skipped ${gc.skipped.join(', ')}`);
      }
      agentRuntimeProber.setManagedResolver((kind) => assets.managedBinary(`agent:${kind}`));
      // Probed once per boot (user-installed CLIs self-update, so results must not outlive a
      // boot); fills the adapters' spawn-path resolution and is served on `agent-runtime.list`.
      // Deliberately not awaited (CODE-225): collect() spawns agent CLIs (`--version`, `auth
      // status`) that take seconds on a cold machine — listener bind must not wait on them, or
      // every client sits on ECONNREFUSED for the whole probe. The engine seeds from the promise.
      const agentRuntimesReady = agentRuntimeProber.collect();
      const engine = new Engine(hub, {
        providerStore: store,
        ptyBackend: new SidecarPtyBackend(resolveSidecarPath()),
        sessionStore: createSessionStore(databasePath()),
        workspaceStore: createWorkspaceStore(databasePath()),
        previewRoutes,
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
          ensureBinary: async () => (await assets.ensure('tool:aigateway'))?.path,
        }),
      });
      // Refresh consented managed installs in the background — boot never waits on a download. A
      // never-installed agent waits for the client's explicit `asset.ensure` instead (CODE-221).
      // Rides the probe promise (CODE-225); the engine exists first so its asset subscription
      // sees the whole install lifecycle.
      void agentRuntimesReady
        .then((agentRuntimes) => {
          for (const kind of agentsToRefresh(consentedAgents, agentRuntimes)) {
            void assets
              .ensure(`agent:${kind}`)
              .catch((err) => {
                console.warn(
                  `[linkcode/daemon] managed install failed for ${kind}: ${extractErrorMessage(err)}`,
                );
              })
              .then((installed) => {
                if (installed) {
                  console.log(
                    `[linkcode/daemon] managed runtime ready: ${installed.id}@${installed.version}`,
                  );
                }
              });
          }
        })
        .catch((err) => {
          console.warn(`[linkcode/daemon] boot agent probe failed: ${extractErrorMessage(err)}`);
        });
      yield* Effect.acquireRelease(
        Effect.promise(() => engine.start()),
        () => finalize(() => engine.stop()),
      );
      // Runs before any listener binds, so `workspace.list` always includes the chat workspace by
      // the time a client can connect.
      yield* Effect.promise(() => engine.ensureChatWorkspace(chatWorkspaceRoot()));
      return engine;
    }),
  );

  const ListenersLive = Layer.effect(
    BoundListeners,
    Effect.gen(function* () {
      const { config, identity, hub, previewRoutes } = yield* Shared;
      // Ordering only: listeners must not bind before the engine is started and the chat
      // workspace exists.
      yield* EngineHandle;
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
            console.log(`[linkcode/daemon] listening on ${url} (${listener.type})`);
            return { type: listener.type, url } satisfies DaemonListenerInfo;
          }),
        { concurrency: 'unbounded' },
      ).pipe(
        Effect.tapError((err) =>
          Effect.sync(() => {
            if (err instanceof DaemonAlreadyRunningError) {
              console.error(`[linkcode/daemon] ${extractErrorMessage(err)}`);
            }
          }),
        ),
      );
    }),
  );

  // Advertise local discovery only after every listener is bound, then bring up the HQ uplink.
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
        Effect.sync(() => startHqUplink(hub)),
        (stop) => finalize(stop),
      );
    }),
  );

  const MainLive = LifecycleLive.pipe(
    Layer.provideMerge(ListenersLive),
    Layer.provideMerge(EngineLive),
    Layer.provideMerge(SharedLive),
  );

  // runMain turns SIGINT/SIGTERM into fiber interruption but has no escalation of its own: a
  // hung finalizer would leave an unkillable-by-TERM orphan. First signal arms a drain deadline;
  // a second signal force-exits immediately.
  let signalCount = 0;
  const escalate = (): void => {
    signalCount += 1;
    if (signalCount > 1) {
      console.error('[linkcode/daemon] second signal during shutdown; forcing exit');
      process.exit(1);
    }
    const deadline = setTimeout(() => {
      console.error('[linkcode/daemon] shutdown drain timed out; forcing exit');
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);
    deadline.unref();
  };
  process.on('SIGINT', escalate);
  process.on('SIGTERM', escalate);

  NodeRuntime.runMain(Layer.launch(MainLive), { teardown, disableErrorReporting: true });
}

main().catch((err: unknown) => {
  console.error('[linkcode/daemon] fatal:', err);
  process.exit(1);
});
