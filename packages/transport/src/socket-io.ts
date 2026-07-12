import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { ManagerOptions, Socket, SocketOptions } from 'socket.io-client';
import { io } from 'socket.io-client';
import { WireConnection } from './transport';

const FRAME_EVENT = 'frame';

export interface SocketIoTransportOptions {
  url: string;
  options?: Omit<
    Partial<ManagerOptions & SocketOptions>,
    'autoConnect' | 'forceNew' | 'multiplex' | 'reconnection'
  >;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'closed';

/**
 * SocketIoTransport: browser / RN / Node client implementation backed by Socket.IO.
 *
 * Socket.IO stays a product-level carrier here: business semantics are still carried as schema-validated
 * WireMessage frames, so upper layers do not depend on Socket.IO event names. Each instance owns one
 * connection lifetime; recovery creates a fresh transport instead of reconnecting underneath its owner.
 */
export class SocketIoTransport extends WireConnection {
  private socket: Socket | null = null;
  private state: ConnectionState = 'idle';
  private rejectConnecting: ((error: Error) => void) | null = null;

  constructor(private readonly opts: SocketIoTransportOptions) {
    super('SocketIoTransport');
  }

  override connect(): Promise<void> {
    if (this.state !== 'idle') {
      return Promise.reject(new Error('SocketIoTransport: connection already started'));
    }
    this.state = 'connecting';
    const socket = io(this.opts.url, {
      ...this.opts.options,
      autoConnect: false,
      forceNew: true,
      reconnection: false,
    });
    this.socket = socket;
    this.armClosedListener();

    socket.on(FRAME_EVENT, (raw: unknown) => {
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    socket.on('disconnect', () => {
      const wasConnecting = this.state === 'connecting';
      this.state = 'closed';
      if (this.socket === socket) this.socket = null;
      if (wasConnecting) {
        this.rejectConnecting?.(new Error('SocketIoTransport: connection closed'));
      }
      this.emitClosed();
    });

    return new Promise<void>((resolve, reject) => {
      let onConnect: () => void;
      let onConnectError: (error: Error) => void;
      const cleanup = (): void => {
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        this.rejectConnecting = null;
      };
      const rejectConnect = (error: Error): void => {
        cleanup();
        reject(error);
      };
      onConnect = (): void => {
        if (this.state !== 'connecting') return;
        this.state = 'connected';
        cleanup();
        resolve();
      };
      onConnectError = (error: Error): void => {
        if (this.state !== 'connecting') return;
        this.state = 'closed';
        if (this.socket === socket) this.socket = null;
        rejectConnect(error);
        socket.disconnect();
        this.emitClosed();
      };

      this.rejectConnecting = rejectConnect;
      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);
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
    if (this.state === 'closed') return;
    this.state = 'closed';
    const socket = this.socket;
    this.socket = null;
    this.rejectConnecting?.(new Error('SocketIoTransport: connection closed'));
    socket?.disconnect();
    this.emitClosed();
  }
}
