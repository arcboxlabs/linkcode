import { createServer } from 'node:http';
import type { DaemonIdentity, WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { Socket } from 'socket.io';
import { Server as SocketIoServerImpl } from 'socket.io';
import {
  boundPort,
  closeServerPair,
  createIdentityRequestHandler,
  listenHttp,
} from './http-server';
import type { Transport, TransportServer } from './transport';
import { Listeners, WireConnection } from './transport';

const FRAME_EVENT = 'frame';

export interface SocketIoServerOptions {
  port: number;
  host?: string;
  /** Served at `GET /linkcode` so peers can tell this port belongs to a linkcode daemon. */
  identity?: DaemonIdentity;
}

export interface SocketIoServer extends TransportServer {
  readonly port: number;
}

class SocketIoServerConnection extends WireConnection {
  constructor(private readonly socket: Socket) {
    super('SocketIoServer');
    // The Socket.IO connection is already live when handed to us, so emitClosed is armed up front.
    this.armClosedListener();

    socket.on(FRAME_EVENT, (raw: unknown) => {
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    socket.on('disconnect', () => this.emitClosed());
  }

  protected sendBytes(msg: WireMessage): void {
    if (this.socket.connected) this.socket.emit(FRAME_EVENT, msg);
  }

  close(): void {
    this.socket.disconnect(true);
    this.emitClosed();
  }
}

export async function createSocketIoServer(opts: SocketIoServerOptions): Promise<SocketIoServer> {
  const httpServer = createServer(createIdentityRequestHandler(opts.identity));
  const io = new SocketIoServerImpl(httpServer, {
    cors: { origin: true },
  });
  const connections = new Listeners<Transport>();

  io.on('connection', (socket) => {
    connections.emit(new SocketIoServerConnection(socket));
  });

  await listenHttp(httpServer, opts.port, opts.host);

  return {
    port: boundPort(httpServer, opts.port),
    onConnection: (cb) => connections.add(cb),
    close: () => closeServerPair(io, httpServer),
  };
}
