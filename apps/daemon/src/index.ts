import { agentRuntimeProber } from '@linkcode/agent-adapter';
import { AssetManager } from '@linkcode/assets';
import { Engine, PreviewRouteRegistry } from '@linkcode/engine';
import type { DaemonIdentity, DaemonListenerInfo } from '@linkcode/schema';
import { DAEMON_EXIT_ALREADY_RUNNING, ManagedAssetIdSchema } from '@linkcode/schema';
import type { TransportServer } from '@linkcode/transport/server';
import { Hub } from '@linkcode/transport/server';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { once } from 'foxts/once';
import { installAsarSpawnFix } from './asar-spawn';
import { chatWorkspaceRoot, databasePath, loadConfig } from './config';
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

// An uncaught exception means the stack unwound through code that never expected to fail there —
// the process's state (which sessions are live, what's mid-write) is no longer trustworthy, so it
// must die loudly rather than keep serving clients from an unknown state.
process.on('uncaughtException', (err) => {
  console.error('[linkcode/daemon] uncaught exception:', err);
  process.exit(1);
});

// Unlike an uncaught exception, a rejected promise with no handler is usually scoped to whatever
// async operation produced it (e.g. one session's adapter call) — the rest of the daemon's state
// stays coherent, so this logs rather than exits. Every fire-and-forget path this ticket touched
// (session persistence, the adapter event pipe, message handling) already attaches its own
// `.catch`/try-catch; a rejection surfacing here means one of those was missed and needs fixing,
// not that the daemon must go down immediately.
process.on('unhandledRejection', (reason) => {
  console.error('[linkcode/daemon] unhandled rejection:', reason);
});

/**
 * Link Code daemon — the standalone local host process.
 *
 * Runs one shared `Engine` (which owns all agent sessions + adapters) behind a fan-out `Hub`, and exposes
 * configured listeners for clients (web / desktop / mobile-via-relay / cli). This is where real agents live:
 * they spawn CLI subprocesses and hold credentials, so they cannot run inside a browser tab.
 */
async function main(): Promise<void> {
  // Before the engine starts: agent adapters spawn vendored CLI binaries that resolve inside the
  // desktop app's asar (no-op outside Electron — see asar-spawn.ts).
  installAsarSpawnFix();
  const config = loadConfig();

  // One daemon per machine — a second instance would share ~/.linkcode/daemon.db and split sessions.
  const running = await findRunningDaemon();
  if (running) {
    const urls = running.listeners.map((listener) => listener.url).join(', ');
    console.error(`[linkcode/daemon] already running (pid ${running.pid}) at ${urls}`);
    // Explicit exit, not exitCode+return: under utilityProcess the parent IPC channel keeps the
    // event loop alive forever, so a natural exit never happens and the supervisor never hears it.
    process.exit(DAEMON_EXIT_ALREADY_RUNNING);
  }

  const identity: DaemonIdentity = {
    name: 'linkcode-daemon',
    pid: process.pid,
    startedAt: Date.now(),
  };
  const hub = new Hub();
  const store = createProviderConfigStore(config.providers ?? {});
  // Shared between the engine's script service (writer) and every listener's reverse
  // proxy (reader). Preview traffic bypasses daemon auth by decision — the boundary is
  // the loopback bind (see config.ts DEFAULT_HOST); remote exposure is the tunnel's job.
  const previewRoutes = new PreviewRouteRegistry();
  // Managed assets (CODE-111): GC superseded versions before anything can spawn, then feed the
  // store into spawn resolution — managed wins over detected as soon as an install lands on disk.
  const assets = new AssetManager();
  const gc = assets.gcAtBoot();
  if (gc.removed.length > 0) {
    console.log(`[linkcode/daemon] assets gc: removed ${gc.removed.join(', ')}`);
  }
  if (gc.skipped.length > 0) {
    console.warn(`[linkcode/daemon] assets gc: skipped ${gc.skipped.join(', ')}`);
  }
  // Probeable kinds without an `agent:<kind>` managed asset (amp today — its SDK resolves its
  // own binary and takes no per-call path a store install could ride) parse-fail and resolve to
  // undefined; the schema stays the single source of which agents have managed downloads.
  agentRuntimeProber.setManagedResolver((kind) => {
    const assetId = ManagedAssetIdSchema.safeParse(`agent:${kind}`);
    return assetId.success ? assets.managedBinary(assetId.data) : undefined;
  });
  // Probed once per boot (user-installed CLIs self-update, so results must not outlive a boot);
  // fills the adapters' spawn-path resolution and is served to clients on `agent-runtime.list`.
  const agentRuntimes = await agentRuntimeProber.collect();
  const engine = new Engine(hub, {
    providerStore: store,
    ptyBackend: new SidecarPtyBackend(resolveSidecarPath()),
    sessionStore: createSessionStore(databasePath()),
    workspaceStore: createWorkspaceStore(databasePath()),
    previewRoutes,
    agentRuntimes,
    assets,
    // Lets the engine refresh (and push) the runtime snapshot after a managed install lands.
    collectAgentRuntimes: () => agentRuntimeProber.collect(),
  });
  // Warm missing agent pairs in the background — boot never waits on a download. Anything the
  // probe already found usable (detected CLI, SDK platform package) is left alone. Runs after
  // the engine exists so its asset subscription sees the whole install lifecycle.
  for (const kind of ['claude-code', 'codex'] as const) {
    if (agentRuntimes[kind]?.status === 'available') continue;
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
  await engine.start();
  // Runs before any listener binds, so `workspace.list` always includes the chat workspace by the
  // time a client can connect.
  await engine.ensureChatWorkspace(chatWorkspaceRoot());

  // Host terminals (panel shells) have no owner once every client is gone — a quit or crashed
  // app can never close its own. Reap them after a grace window; a reconnect within it reattaches
  // to the same terminals untouched.
  const HOST_TERMINAL_REAP_DELAY_MS = 60000;
  let reapTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelReap = (): void => {
    if (reapTimer !== null) {
      clearTimeout(reapTimer);
      reapTimer = null;
    }
  };

  const servers: TransportServer[] = [];
  const stopAll = async (): Promise<void> => {
    cancelReap();
    await Promise.all(servers.map((server) => server.close()));
    hub.close();
    await engine.stop();
  };

  try {
    // Listeners hunt concurrently; a transient collision between two of our own hunts resolves
    // itself because listenWithPortHunt treats an occupant with our pid as "keep hunting".
    const bound: DaemonListenerInfo[] = await Promise.all(
      config.listeners.map(async (listener) => {
        const { server, url, port } = await listenWithPortHunt(listener, identity, previewRoutes);
        // Preview URLs carry the first bound port; every listener proxies the same table.
        previewRoutes.proxyPort ??= port;
        server.onConnection((conn) => {
          cancelReap();
          hub.addConnection(conn);
          conn.onClose(() => {
            hub.removeConnection(conn);
            if (hub.size === 0) {
              cancelReap();
              reapTimer = setTimeout(() => engine.reapHostTerminals(), HOST_TERMINAL_REAP_DELAY_MS);
            }
          });
        });
        servers.push(server);
        console.log(`[linkcode/daemon] listening on ${url} (${listener.type})`);
        return { type: listener.type, url };
      }),
    );
    writeRuntimeFile({ ...identity, listeners: bound });
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      console.error(`[linkcode/daemon] ${extractErrorMessage(err)}`);
      await stopAll();
      // See the findRunningDaemon branch above for why this must be an explicit exit.
      process.exit(DAEMON_EXIT_ALREADY_RUNNING);
    }
    throw err;
  }

  // foxts `once` prewarms (executes) by default; `false` defers it to the first real call.
  const shutdown = once((): void => {
    void (async () => {
      try {
        removeRuntimeFile();
        await stopAll();
      } catch (err) {
        console.error('[linkcode/daemon] error during shutdown:', err);
      } finally {
        process.exit(0);
      }
    })();
  }, false);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[linkcode/daemon] fatal:', err);
  process.exit(1);
});
