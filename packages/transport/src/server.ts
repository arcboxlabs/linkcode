/**
 * @linkcode/transport/server — Node-only server entry for the host daemon.
 * Kept separate from the main entry so the Node `ws` dependency never reaches browser / RN bundles.
 */

import { never } from 'foxts/guard';
import type { SocketIoServerOptions } from './socket-io-server';
import { createSocketIoServer } from './socket-io-server';
import type { TransportServer } from './transport';
import type { WsServerOptions } from './ws-server';
import { createWsServer } from './ws-server';

export * from './hub';
export * from './socket-io-server';
export type { TransportServer } from './transport';
export * from './ws-server';

export type TransportServerOptions =
  | ({ type: 'socket.io' } & SocketIoServerOptions)
  | ({ type: 'ws' } & WsServerOptions);

/** Resolves once the listener is bound; rejects on bind failure (e.g. `EADDRINUSE`). */
export function createTransportServer(opts: TransportServerOptions): Promise<TransportServer> {
  switch (opts.type) {
    case 'socket.io':
      return createSocketIoServer({ port: opts.port, host: opts.host, identity: opts.identity });
    case 'ws':
      return createWsServer({ port: opts.port, host: opts.host, identity: opts.identity });
    default:
      return never(opts, 'transport server type');
  }
}
