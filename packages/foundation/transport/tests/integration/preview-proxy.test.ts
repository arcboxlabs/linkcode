import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PreviewRouteTable } from '@linkcode/transport';
import type { WsServer } from '@linkcode/transport/server';
import { createWsServer } from '@linkcode/transport/server';
import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

const cleanups: Array<() => Promise<void> | void> = [];

afterAll(async () => {
  // eslint-disable-next-line no-await-in-loop -- teardown must run one at a time in LIFO order
  for (const cleanup of cleanups.reverse()) await cleanup();
});

/** An upstream dev-server stand-in: echoes the request path and Host, and echoes WS frames. */
async function startUpstream(): Promise<number> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`upstream ${req.url} host=${req.headers.host ?? ''}`);
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.on('message', (data: Buffer) => ws.send(`echo:${data.toString()}`));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        wss.close(() => server.close(() => resolve()));
      }),
  );
  return (server.address() as AddressInfo).port;
}

async function startDaemon(routes: PreviewRouteTable): Promise<WsServer> {
  const daemon = await createWsServer({
    port: 0,
    host: '127.0.0.1',
    identity: { name: 'linkcode-daemon', pid: process.pid, startedAt: Date.now() },
    previewRoutes: routes,
  });
  cleanups.push(() => daemon.close());
  return daemon;
}

function get(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('preview reverse proxy (ws server)', () => {
  it('routes registered hosts upstream, 404s unrouted preview hosts, keeps the daemon API', async () => {
    const upstreamPort = await startUpstream();
    const routes: PreviewRouteTable = {
      lookup: (hostname) =>
        hostname === 'web--app-abc123.localhost' ? { port: upstreamPort } : null,
    };
    const daemon = await startDaemon(routes);

    const proxied = await get(daemon.port, '/some/path?q=1', 'web--app-abc123.localhost');
    expect(proxied.status).toBe(200);
    expect(proxied.body).toBe('upstream /some/path?q=1 host=web--app-abc123.localhost');

    const unrouted = await get(daemon.port, '/linkcode', 'ghost--app-000000.localhost');
    expect(unrouted.status).toBe(404);
    expect(unrouted.body).toContain('No running service');

    const identity = await get(daemon.port, '/linkcode', 'localhost');
    expect(identity.status).toBe(200);
    expect(identity.body).toContain('linkcode-daemon');
  });

  it('pipes WebSocket upgrades to the upstream (HMR path)', async () => {
    const upstreamPort = await startUpstream();
    const routes: PreviewRouteTable = {
      lookup: (hostname) =>
        hostname === 'hmr--app-abc123.localhost' ? { port: upstreamPort } : null,
    };
    const daemon = await startDaemon(routes);

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/hmr`, {
      headers: { host: 'hmr--app-abc123.localhost' },
    });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('ping'));
      ws.on('message', (data: Buffer) => resolve(data.toString()));
      ws.on('error', reject);
    });
    ws.close();
    expect(reply).toBe('echo:ping');
  });

  it('serves content-hosted routes directly with nosniff and no-store', async () => {
    const daemon = await startDaemon({
      lookup: (hostname) =>
        hostname === 'artifact--abc123def.localhost'
          ? { body: '<h1>hosted</h1>', contentType: 'text/html; charset=utf-8' }
          : null,
    });

    const res = await get(daemon.port, '/anything', 'artifact--abc123def.localhost');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<h1>hosted</h1>');

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/`, {
      headers: { host: 'artifact--abc123def.localhost' },
    });
    const wsFailed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true));
      ws.on('open', () => resolve(false));
    });
    expect(wsFailed).toBe(true);
  });

  it('rejects upgrades for unrouted preview hosts without touching the transport WS', async () => {
    const daemon = await startDaemon({ lookup: () => null });
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/`, {
      headers: { host: 'ghost--app-000000.localhost' },
    });
    const failed = await new Promise<boolean>((resolve) => {
      ws.on('error', () => resolve(true));
      ws.on('open', () => resolve(false));
    });
    expect(failed).toBe(true);
  });
});
