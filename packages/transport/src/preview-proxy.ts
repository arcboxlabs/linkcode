import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import type { Duplex } from 'node:stream';
import type { PreviewRouteTable } from './preview-routes';
import { isPreviewHostname, normalizeHostname } from './preview-routes';

/**
 * Host-routed reverse proxy for workspace service previews (CODE-58). Classification
 * by Host header only — preview traffic deliberately bypasses any daemon auth (decided
 * boundary: the daemon binds loopback; remote exposure is the tunnel layer's job):
 *
 * - registered preview hostname → forward to `127.0.0.1:<port>`
 * - looks like a preview hostname but unrouted → 404, never falling through to the
 *   daemon API
 * - anything else → the daemon's own handler
 */

/** Wraps the daemon's request handler with Host-classified proxying. */
export function createPreviewRequestHandler(
  routes: PreviewRouteTable,
  fallback: RequestListener,
): RequestListener {
  return (req, res) => {
    const hostname = normalizeHostname(req.headers.host);
    if (hostname === null || !isPreviewHostname(hostname)) {
      fallback(req, res);
      return;
    }
    const route = routes.lookup(hostname);
    if (route === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`No running service for ${hostname}\n`);
      return;
    }
    proxyRequest(req, res, route.port);
  };
}

/**
 * Upgrade interceptor (Vite/Metro HMR WebSockets). Returns true when the socket was
 * taken over (proxied or rejected); false means the caller's own WS server owns it.
 */
export function handlePreviewUpgrade(
  routes: PreviewRouteTable,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const hostname = normalizeHostname(req.headers.host);
  if (hostname === null || !isPreviewHostname(hostname)) return false;
  const route = routes.lookup(hostname);
  if (route === null) {
    socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\n\r\n');
    return true;
  }
  proxyUpgrade(req, socket, head, route.port);
  return true;
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, port: number): void {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: req.url,
      // Host header included verbatim: dev servers allow `.localhost` hosts and some
      // (HMR client URL derivation) want the original.
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Bad gateway\n');
  });
  req.pipe(upstream);
}

/** Replays the upgrade request verbatim over a raw TCP pipe (headers are not ours to
 * interpret — the upstream dev server completes the WebSocket handshake itself). */
function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number): void {
  const upstream = netConnect(port, '127.0.0.1');
  const destroyBoth = (): void => {
    socket.destroy();
    upstream.destroy();
  };

  upstream.on('connect', () => {
    const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', destroyBoth);
  socket.on('error', destroyBoth);
}
