import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import { io } from 'socket.io-client';
import { WireConnection } from './transport';

const FRAME_EVENT = 'frame';

export interface SocketIoTransportOptions {
  url: string;
  options?: Partial<ManagerOptions & SocketOptions>;
}

/**
 * SocketIoTransport: browser / RN / Node client implementation backed by Socket.IO.
 *
 * Socket.IO stays a product-level carrier here: business semantics are still carried as schema-validated
 * WireMessage frames, so upper layers do not depend on Socket.IO event names.
 */
export class SocketIoTransport extends WireConnection {
  private socket: Socket | null = null;

  constructor(private readonly opts: SocketIoTransportOptions) {
    super('SocketIoTransport');
  }

  override connect(): Promise<void> {
    const socket = io(this.opts.url, {
      ...this.opts.options,
      autoConnect: false,
    });
    this.socket = socket;
    this.armClosedListener();

    socket.on(FRAME_EVENT, (raw: unknown) => {
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    socket.on('disconnect', () => this.emitClosed());

    return new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err: Error) => reject(err));
      socket.connect();
    });
  }

  protected sendBytes(msg: WireMessage): void {
    if (!this.socket?.connected) {
      throw new Error('SocketIoTransport: socket not connected');
    }
    this.socket.emit(FRAME_EVENT, msg);
  }

  close(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.emitClosed();
  }
}
