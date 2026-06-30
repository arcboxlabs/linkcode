import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import { io } from 'socket.io-client';
import type { Transport, Unsubscribe } from './transport';
import { Listeners } from './transport';

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
export class SocketIoTransport implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();
  private socket: Socket | null = null;
  private isClosed = true;

  constructor(private readonly opts: SocketIoTransportOptions) {}

  connect(): Promise<void> {
    const socket = io(this.opts.url, {
      ...this.opts.options,
      autoConnect: false,
    });
    this.socket = socket;
    this.isClosed = false;

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

  send(msg: WireMessage): void {
    if (!this.socket?.connected) {
      throw new Error('SocketIoTransport: socket not connected');
    }
    const parsed = parseWireMessage(msg);
    if (!parsed.success) {
      throw new Error(`SocketIoTransport: invalid WireMessage: ${parsed.error.message}`);
    }
    this.socket.emit(FRAME_EVENT, parsed.data);
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.emitClosed();
  }

  private emitClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.inbound.clear();
    this.closed.emit();
  }
}
