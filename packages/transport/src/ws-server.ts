import type { Server as HttpServer } from 'node:http';
import { createServer } from 'node:http';
import type { DaemonIdentity, WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { RawData } from 'ws';
import { WebSocket, WebSocketServer } from 'ws';
import { boundPort, createIdentityRequestHandler, listenHttp } from './http-server';
import type { Transport, TransportServer } from './transport';
import { Listeners, WireConnection } from './transport';

/**
 * Node-side WebSocket **server** for the host daemon. This module imports the Node-only `ws` package and is
 * therefore exposed via the `@linkcode/transport/server` subpath only — never from the main entry, so it is
 * never pulled into the browser (web) or React Native (mobile) bundles, which use the isomorphic
 * `WsTransport` client instead.
 */

export interface WsServerOptions {
  port: number;
  host?: string;
  /** Served at `GET /linkcode` so peers can tell this port belongs to a linkcode daemon. */
  identity?: DaemonIdentity;
}

export interface WsServer extends TransportServer {
  readonly port: number;
}

const textDecoder = new TextDecoder();

class WsServerConnection extends WireConnection {
  constructor(private readonly ws: WebSocket) {
    super('WsServer');
    // The socket is already live when handed to us, so emitClosed is armed up front.
    this.armClosedListener();

    ws.on('message', (data: RawData) => {
      let raw: unknown;
      try {
        raw = JSON.parse(rawDataToString(data));
      } catch {
        return; // Not JSON, discard.
      }
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    ws.on('close', () => {
      this.emitClosed();
    });
  }

  protected sendBytes(msg: WireMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
    this.emitClosed();
  }
}

function rawDataToString(data: RawData): string {
  return textDecoder.decode(Array.isArray(data) ? Buffer.concat(data) : data);
}

/** Start a WebSocket server; each accepted socket is surfaced as a `ServerConnection`. */
export async function createWsServer(opts: WsServerOptions): Promise<WsServer> {
  const httpServer = createServer(createIdentityRequestHandler(opts.identity));
  await listenHttp(httpServer, opts.port, opts.host);

  // Attach only after a successful bind: `ws` re-emits the http server's 'error' events on the
  // wss, which would turn a handled bind failure into an unhandled-'error' crash.
  const wss = new WebSocketServer({ server: httpServer });
  const connections = new Listeners<Transport>();

  wss.on('connection', (ws) => {
    connections.emit(new WsServerConnection(ws));
  });

  return {
    port: boundPort(httpServer, opts.port),
    onConnection: (cb) => connections.add(cb),
    close: () => closeWsServer(wss, httpServer),
  };
}

function closeWsServer(wss: WebSocketServer, httpServer: HttpServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    wss.close((err) => {
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
