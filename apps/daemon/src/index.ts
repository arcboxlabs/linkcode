import { Engine } from '@linkcode/engine';
import type { TransportServer } from '@linkcode/transport/server';
import { createTransportServer, Hub } from '@linkcode/transport/server';
import { once } from 'foxts/once';
import type { DaemonListenerConfig } from './config';
import { databasePath, loadConfig } from './config';
import { createProviderConfigStore } from './provider-store';
import { resolveSidecarPath, SidecarPtyBackend } from './pty/sidecar';
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

  const servers: TransportServer[] = [];
  for (const listener of config.listeners) {
    const server = createTransportServer(listener);
    server.onConnection((conn) => {
      hub.addConnection(conn);
      conn.onClose(() => hub.removeConnection(conn));
    });
    servers.push(server);
    console.log(`[linkcode/daemon] listening on ${formatListener(listener)}`);
  }

  // foxts/once prewarms (runs the fn at creation) by default — pass false or the daemon shuts down at startup.
  const shutdown = once((): void => {
    void (async () => {
      try {
        await Promise.all(servers.map((server) => server.close()));
        hub.close();
        await engine.stop();
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

function formatListener(listener: DaemonListenerConfig): string {
  switch (listener.type) {
    case 'socket.io':
      return `socket.io on http://${listener.host ?? '0.0.0.0'}:${listener.port}`;
    case 'ws':
      return `ws://${listener.host ?? '0.0.0.0'}:${listener.port}`;
    default:
      return 'unknown listener';
  }
}
