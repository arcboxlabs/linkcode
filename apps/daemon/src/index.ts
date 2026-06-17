import { Host } from '@linkcode/host';
import { Hub, createWsServer } from '@linkcode/transport/server';
import { loadConfig } from './config';

/**
 * Link Code daemon — the standalone local host process.
 *
 * Runs one shared `Host` (which owns all agent sessions + adapters) behind a fan-out `Hub`, and exposes a
 * WebSocket the clients (web / desktop / mobile-via-relay / cli) connect to. This is where real agents live:
 * they spawn CLI subprocesses and hold credentials, so they cannot run inside a browser tab.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const hub = new Hub();
  const host = new Host(hub);
  await host.start();

  const server = createWsServer({ port: config.port, host: config.hostname });
  server.onConnection((conn) => {
    hub.addConnection(conn);
    conn.onClose(() => hub.removeConnection(conn));
  });

  console.log(`[linkcode/daemon] listening on ws://${config.hostname}:${config.port}`);

  const shutdown = (): void => {
    void (async () => {
      try {
        await host.stop();
        await server.close();
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[linkcode/daemon] fatal:', err);
  process.exit(1);
});
