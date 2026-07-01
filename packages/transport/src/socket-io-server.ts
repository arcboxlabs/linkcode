import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
import type { DaemonIdentity, WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { once } from 'foxts/once';
import type { Socket } from 'socket.io';
import { Server as SocketIoServerImpl } from 'socket.io';
import { boundPort, createIdentityRequestHandler, listenHttp } from './http-server';
import type { Transport, TransportServer, Unsubscribe } from './transport';
import { Listeners } from './transport';

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

class SocketIoServerConnection implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();
  // foxts `once` prewarms (executes) by default; `false` defers it to the first real close.
  private readonly emitClosed = once((): void => {
    this.inbound.clear();
    this.closed.emit();
  }, false);

  constructor(private readonly socket: Socket) {
    socket.on(FRAME_EVENT, (raw: unknown) => {
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    socket.on('disconnect', () => this.emitClosed());
  }

  connect(): Promise<void> {
    return Promise.resolve(); // The Socket.IO connection is already open when handed to us.
  }

  send(msg: WireMessage): void {
    const parsed = parseWireMessage(msg);
    if (!parsed.success) {
      throw new Error(`SocketIoServer: invalid WireMessage: ${parsed.error.message}`);
    }
    if (this.socket.connected) this.socket.emit(FRAME_EVENT, parsed.data);
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
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
    close: () => closeSocketIoServer(io, httpServer),
  };
}

function closeSocketIoServer(io: SocketIoServerImpl, httpServer: HttpServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    io.close((ioErr) => {
      if (ioErr) {
        reject(ioErr);
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
