import { once } from 'node:events';
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import type { DaemonIdentity } from '@linkcode/schema';
import { DAEMON_IDENTITY_PATH } from '@linkcode/schema';

/** Shared HTTP plumbing for the Node server transports: the `GET /linkcode` identity endpoint
 * (tells a linkcode daemon apart from a foreign process holding the port) and a `listen` that
 * surfaces bind errors (e.g. `EADDRINUSE`) as rejections instead of unhandled `'error'` events. */

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

/** The subset of `WebSocketServer` / socket.io `Server` that `closeServerPair` needs to shut one down. */
export interface ClosablePrimaryServer {
  close(cb: (err?: Error | null) => void): void;
}

/** Close a primary server (the `ws` `WebSocketServer` or the socket.io `Server`) and, once it has
 * finished, the underlying HTTP server it rides on — shared by ws-server.ts and socket-io-server.ts. */
export function closeServerPair(
  primary: ClosablePrimaryServer,
  httpServer: HttpServer,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    primary.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      if (!httpServer.listening) {
        resolve();
        return;
      }
      httpServer.close((httpErr) => (httpErr ? reject(httpErr) : resolve()));
    });
  });
}
