/**
 * @linkcode/transport/server — Node-only server entry for the host daemon.
 * Kept separate from the main entry so the Node `ws` dependency never reaches browser / RN bundles.
 */
import { type SocketIoServerOptions, createSocketIoServer } from './socket-io-server';
import type { TransportServer } from './transport';
import { type WsServerOptions, createWsServer } from './ws-server';

export * from './socket-io-server';
export * from './ws-server';
export * from './hub';
export type { TransportServer } from './transport';

export type TransportServerOptions =
  | ({ type: 'socket.io' } & SocketIoServerOptions)
  | ({ type: 'ws' } & WsServerOptions);

export function createTransportServer(opts: TransportServerOptions): TransportServer {
  switch (opts.type) {
    case 'socket.io':
      return createSocketIoServer({ port: opts.port, host: opts.host });
    case 'ws':
      return createWsServer({ port: opts.port, host: opts.host });
  }
}
