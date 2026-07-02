import { Engine } from '@linkcode/engine';
import type { DaemonIdentity, DaemonListenerInfo } from '@linkcode/schema';
import type { TransportServer } from '@linkcode/transport/server';
import { Hub } from '@linkcode/transport/server';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { once } from 'foxts/once';
import { databasePath, loadConfig } from './config';
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
  );
  await engine.start();

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
