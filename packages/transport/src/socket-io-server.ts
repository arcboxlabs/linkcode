import { createServer } from 'node:http';
import type { DaemonIdentity, WireMessage } from '@linkcode/schema';
import { MAX_ATTACHMENT_TOTAL_BASE64_LENGTH, parseWireMessage } from '@linkcode/schema';
import type { Socket } from 'socket.io';
import { Server as SocketIoServerImpl } from 'socket.io';
import {
  boundPort,
  closeServerPair,
  createIdentityRequestHandler,
  listenHttp,
} from './http-server';
import { createPreviewRequestHandler, handlePreviewUpgrade } from './preview-proxy';
import type { PreviewRouteTable } from './preview-routes';
import { isPreviewOrigin } from './preview-routes';
import type { Transport, TransportServer } from './transport';
import { Listeners, WireConnection } from './transport';

const FRAME_EVENT = 'frame';

export interface SocketIoServerOptions {
  port: number;
  host?: string;
  /** Served at `GET /linkcode` so peers can tell this port belongs to a linkcode daemon. */
  identity?: DaemonIdentity;
  /** Enables the Host-routed preview reverse proxy (requests + WS upgrades). */
  previewRoutes?: PreviewRouteTable;
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
  const identityHandler = createIdentityRequestHandler(opts.identity);
  const previewRoutes = opts.previewRoutes;
  const httpServer = createServer(
    previewRoutes ? createPreviewRequestHandler(previewRoutes, identityHandler) : identityHandler,
  );
  // The proxy's upgrade listener registers BEFORE socket.io attaches its own, and
  // `destroyUpgrade: false` keeps engine.io from reaping proxied upgrades. Known limitation: a
  // preview app requesting the daemon's own `/socket.io/` path is answered here, not proxied.
  if (previewRoutes) {
    httpServer.on('upgrade', (req, socket, head) => {
      handlePreviewUpgrade(previewRoutes, req, socket, head);
    });
  }
  const io = new SocketIoServerImpl(httpServer, {
    // Reflect any origin EXCEPT the preview/artifact namespace: hosted artifact pages
    // must not be able to reach the daemon's own endpoints from the browser.
    cors: {
      origin(origin, callback) {
        callback(null, origin === undefined || !isPreviewOrigin(origin));
      },
    },
    destroyUpgrade: previewRoutes === undefined,
    // Default is 1 MB — too small for image attachments. Exceeding this buffer kills the whole
    // connection (ws close 1009), not one request, so the headroom over
    // MAX_ATTACHMENT_TOTAL_BASE64_LENGTH must absorb the JSON envelope and text blocks.
    maxHttpBufferSize: MAX_ATTACHMENT_TOTAL_BASE64_LENGTH + 4 * 1024 * 1024,
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
