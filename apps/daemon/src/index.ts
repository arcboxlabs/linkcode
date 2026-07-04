import { Engine } from '@linkcode/engine';
import type { DaemonIdentity, DaemonListenerInfo } from '@linkcode/schema';
import type { TransportServer } from '@linkcode/transport/server';
import { Hub } from '@linkcode/transport/server';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { once } from 'foxts/once';
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
  const config = loadConfig();

  // One daemon per machine — a second instance would share ~/.linkcode/daemon.db and split sessions.
  const running = await findRunningDaemon();
  if (running) {
    const urls = running.listeners.map((listener) => listener.url).join(', ');
    console.error(`[linkcode/daemon] already running (pid ${running.pid}) at ${urls}`);
    process.exitCode = 1;
    return;
  }

  const identity: DaemonIdentity = {
    name: 'linkcode-daemon',
    pid: process.pid,
    startedAt: Date.now(),
  };
  const hub = new Hub();
  const store = createProviderConfigStore(config.providers ?? {});
  const engine = new Engine(
    hub,
    undefined,
    store,
    new SidecarPtyBackend(resolveSidecarPath()),
    createSessionStore(databasePath()),
    undefined,
    createWorkspaceStore(databasePath()),
  );
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
        const { server, url } = await listenWithPortHunt(listener, identity);
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
      process.exitCode = 1;
      return;
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
