import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import { Listeners, type Transport, type Unsubscribe } from './transport';

/**
 * Node-side WebSocket **server** for the host daemon. This module imports the Node-only `ws` package and is
 * therefore exposed via the `@linkcode/transport/server` subpath only — never from the main entry, so it is
 * never pulled into the browser (web) or React Native (mobile) bundles, which use the isomorphic
 * `WsTransport` client instead.
 */

export interface WsServerOptions {
  port: number;
  host?: string;
}

/** A single accepted client socket, presented to the daemon as a `Transport` (already open). */
export interface ServerConnection extends Transport {
  /** Fires when the underlying socket closes; use it to drop the connection from the Hub. */
  onClose(cb: () => void): Unsubscribe;
}

export interface WsServer {
  readonly port: number;
  /** Subscribe to newly accepted client connections. Register before clients connect. */
  onConnection(cb: (conn: ServerConnection) => void): Unsubscribe;
  close(): Promise<void>;
}

class WsServerConnection implements ServerConnection {
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (data: RawData) => {
      let raw: unknown;
      try {
        raw = JSON.parse(typeof data === 'string' ? data : data.toString());
      } catch {
        return; // Not JSON, discard.
      }
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    ws.on('close', () => {
      this.closed.emit();
      this.inbound.clear();
    });
  }

  connect(): Promise<void> {
    return Promise.resolve(); // The socket is already open when handed to us.
  }

  send(msg: WireMessage): void {
    const parsed = parseWireMessage(msg);
    if (!parsed.success) throw new Error(`WsServer: invalid WireMessage: ${parsed.error.message}`);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(parsed.data));
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    this.ws.close();
  }
}

/** Start a WebSocket server; each accepted socket is surfaced as a `ServerConnection`. */
export function createWsServer(opts: WsServerOptions): WsServer {
  const wss = new WebSocketServer({ port: opts.port, host: opts.host });
  const connections = new Listeners<ServerConnection>();

  wss.on('connection', (ws) => {
    connections.emit(new WsServerConnection(ws));
  });

  return {
    port: opts.port,
    onConnection: (cb) => connections.add(cb),
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
