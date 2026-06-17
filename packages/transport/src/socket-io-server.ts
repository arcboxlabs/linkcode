import { createServer, type Server as HttpServer } from 'node:http';
import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { type Socket, Server as SocketIoServerImpl } from 'socket.io';
import { Listeners, type Transport, type TransportServer, type Unsubscribe } from './transport';

const FRAME_EVENT = 'frame';

export interface SocketIoServerOptions {
  port: number;
  host?: string;
}

export interface SocketIoServer extends TransportServer {
  readonly port: number;
}

class SocketIoServerConnection implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();
  private isClosed = false;

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
    if (!parsed.success)
      throw new Error(`SocketIoServer: invalid WireMessage: ${parsed.error.message}`);
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

  private emitClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.inbound.clear();
    this.closed.emit();
  }
}

export function createSocketIoServer(opts: SocketIoServerOptions): SocketIoServer {
  const httpServer = createServer();
  const io = new SocketIoServerImpl(httpServer, {
    cors: { origin: true },
  });
  const connections = new Listeners<Transport>();

  io.on('connection', (socket) => {
    connections.emit(new SocketIoServerConnection(socket));
  });

  httpServer.listen(opts.port, opts.host);

  return {
    port: opts.port,
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
