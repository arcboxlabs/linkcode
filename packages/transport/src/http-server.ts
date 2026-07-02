import { once } from 'node:events';
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import type { DaemonIdentity } from '@linkcode/schema';
import { DAEMON_IDENTITY_PATH } from '@linkcode/schema';

/**
 * Shared HTTP plumbing for the Node server transports: the `GET /linkcode` identity endpoint
 * (so peers can tell a linkcode daemon from a foreign process holding the port) and a `listen`
 * that surfaces bind errors (e.g. `EADDRINUSE`) as rejections instead of unhandled `'error'` events.
 */

export function createIdentityRequestHandler(
  identity: DaemonIdentity | undefined,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (identity && req.method === 'GET' && req.url?.split('?', 1)[0] === DAEMON_IDENTITY_PATH) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(identity));
      return;
    }
    res.writeHead(404);
    res.end();
  };
}

export async function listenHttp(server: HttpServer, port: number, host?: string): Promise<void> {
  server.listen(port, host);
  // events.once resolves on 'listening' and rejects if 'error' (e.g. EADDRINUSE) fires first.
  await once(server, 'listening');
}

/** The actually-bound port — differs from the requested one when listening on port 0. */
export function boundPort(server: HttpServer, requested: number): number {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : requested;
}
