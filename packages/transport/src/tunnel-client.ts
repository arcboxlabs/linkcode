import { extractErrorMessage } from 'foxts/extract-error-message';
import { TunnelChunkAssembler, TunnelChunkEncoder } from './tunnel-chunk';
import type { TunnelRole } from './tunnel-protocol';
import {
  TUNNEL_MAX_CONNECTION_AGE_MS,
  TUNNEL_PATH,
  TUNNEL_PING_FRAME,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PONG_FRAME,
  TUNNEL_SUBPROTOCOL,
  TunnelCloseCode,
} from './tunnel-protocol';

/**
 * A reconnecting client for the HQ tunnel relay.
 *
 * Vendored from linkcodehq `packages/tunnel` (client.ts) until
 * `@linkcodehq/tunnel` ships on npm; the dependency then replaces this file.
 * Do not diverge from the upstream copy — the canonical tests live upstream.
 */

export type TunnelClientState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface TunnelClientOptions {
  /** HQ origin, e.g. `https://api.linkcode.ai`; http(s) is normalized to ws(s). */
  baseUrl: string;
  role: TunnelRole;
  /** The tunnel host id — the target daemon's registered device id. */
  hostId: string;
  /** Display name advertised on the host list; hosts only. */
  name?: string;
  /**
   * Fresh short-lived tunnel JWT (`GET /auth/token`), called before every
   * (re)connect attempt. A throw means the credential itself is gone (signed
   * out, device revoked) and permanently closes the client.
   */
  getToken: () => Promise<string>;
  /** Inject a WebSocket implementation (for testing); defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Close codes that end the client for good. Everything else — network drops,
 * {@link TunnelCloseCode.StaleConnection}, the 24h
 * {@link TunnelCloseCode.ReauthRequired} cutoff — reconnects with a fresh
 * token under exponential backoff.
 */
const TERMINAL_CLOSE_CODES = new Set<number>([
  1000, // deliberate closure by the peer
  TunnelCloseCode.BadHandshake,
  TunnelCloseCode.Replaced,
  TunnelCloseCode.HostGone,
  TunnelCloseCode.HostNotFound,
  TunnelCloseCode.TooManyConnections,
]);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
/** Rotate host sockets an hour ahead of the relay's 24h eviction. */
const ROTATE_AFTER_MS = TUNNEL_MAX_CONNECTION_AGE_MS - 60 * 60 * 1000;

/** getToken failures are terminal; socket failures retry. The marker tells them apart. */
class TunnelAuthError extends Error {
  override name = 'TunnelAuthError';
}

class TunnelListeners<T> {
  private readonly set = new Set<(value: T) => void>();

  add(cb: (value: T) => void): () => void {
    this.set.add(cb);
    return () => {
      this.set.delete(cb);
    };
  }

  emit(value: T): void {
    for (const cb of this.set) cb(value);
  }

  clear(): void {
    this.set.clear();
  }
}

/**
 * Payloads are opaque strings — serialization and validation stay with the
 * caller; this layer owns the handshake, liveness pings, sub-1MiB chunking,
 * and the reconnect policy.
 *
 * A daemon dials it once as `role: 'host'`; every remote client dials
 * `role: 'client'` for the same host id. The relay merges all client traffic
 * onto the host's single socket and broadcasts host traffic to every client.
 *
 * `connect()` resolves on the first successful open and rejects on a first
 * failure (callers own first-attempt retry UX). Once established, transient
 * drops reconnect internally — `onClose` only fires when the client is
 * permanently done (explicit `close()`, a terminal relay code, or a dead
 * credential).
 */
export class TunnelClient {
  private readonly inbound = new TunnelListeners<string>();
  private readonly closed = new TunnelListeners<void>();
  private readonly stateChanged = new TunnelListeners<TunnelClientState>();
  private readonly encoder = new TunnelChunkEncoder();
  private readonly assembler = new TunnelChunkAssembler();
  private ws: WebSocket | null = null;
  private currentState: TunnelClientState = 'idle';
  private closedByUser = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TunnelClientOptions) {}

  get state(): TunnelClientState {
    return this.currentState;
  }

  async connect(): Promise<void> {
    if (this.currentState !== 'idle') {
      throw new Error(`TunnelClient: connect() while ${this.currentState}`);
    }
    this.setState('connecting');
    try {
      this.adopt(await this.dial());
      this.setState('open');
    } catch (err) {
      // First-attempt failures stay retryable on the same instance.
      this.setState('idle');
      throw err;
    }
  }

  /** Send one logical message; it is chunked under the relay's frame cap internally. */
  send(message: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) {
      throw new Error('TunnelClient: socket not open');
    }
    for (const frame of this.encoder.encode(message)) ws.send(frame);
  }

  onMessage(cb: (message: string) => void): () => void {
    return this.inbound.add(cb);
  }

  /** Fires once, when the client is permanently done. */
  onClose(cb: () => void): () => void {
    return this.closed.add(cb);
  }

  onStateChange(cb: (state: TunnelClientState) => void): () => void {
    return this.stateChanged.add(cb);
  }

  close(): void {
    this.closedByUser = true;
    this.stopTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
    this.finalize();
  }

  private async dial(): Promise<WebSocket> {
    let token: string;
    try {
      token = await this.opts.getToken();
    } catch (err) {
      throw new TunnelAuthError(`TunnelClient: token refresh failed: ${extractErrorMessage(err)}`);
    }
    const url = new URL(TUNNEL_PATH, this.opts.baseUrl.replace(/^http/, 'ws'));
    url.searchParams.set('access_token', token);
    url.searchParams.set('role', this.opts.role);
    url.searchParams.set('host', this.opts.hostId);
    if (this.opts.role === 'host' && this.opts.name) url.searchParams.set('name', this.opts.name);
    const Impl = this.opts.WebSocketImpl ?? Reflect.get(globalThis, 'WebSocket');
    if (!Impl) throw new Error('TunnelClient: no WebSocket implementation available');
    const ws = new Impl(url.toString(), [TUNNEL_SUBPROTOCOL]);
    ws.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('TunnelClient: connection error')), {
        once: true,
      });
    });
    return ws;
  }

  /** Make `ws` the live socket: handlers, liveness pings, host rotation. */
  private adopt(ws: WebSocket): void {
    this.stopTimers();
    this.assembler.reset();
    this.ws = ws;
    // Handlers key on socket identity: a rotated-away or superseded socket's
    // late events must not disturb its successor.
    ws.addEventListener('message', (ev: MessageEvent) => this.handleMessage(ws, ev));
    ws.addEventListener('close', (ev: CloseEvent) => this.handleClose(ws, ev), { once: true });
    this.pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(TUNNEL_PING_FRAME);
    }, TUNNEL_PING_INTERVAL_MS);
    if (this.opts.role === 'host') {
      this.rotateTimer = setTimeout(() => {
        void this.rotate();
      }, ROTATE_AFTER_MS);
    }
  }

  private handleMessage(ws: WebSocket, ev: MessageEvent): void {
    if (ws !== this.ws) return;
    const data: unknown = ev.data;
    if (typeof data === 'string') {
      // Reserved liveness frames; anything else textual is tolerated as a whole message.
      if (data === TUNNEL_PONG_FRAME || data === TUNNEL_PING_FRAME) return;
      this.inbound.emit(data);
    } else if (data instanceof ArrayBuffer) {
      const message = this.assembler.push(data);
      if (message !== null) this.inbound.emit(message);
    }
  }

  private handleClose(ws: WebSocket, ev: CloseEvent): void {
    if (ws !== this.ws) return;
    this.stopTimers();
    this.ws = null;
    this.assembler.reset();
    if (this.closedByUser || TERMINAL_CLOSE_CODES.has(ev.code)) {
      this.finalize();
    } else {
      void this.reconnectLoop();
    }
  }

  private async reconnectLoop(): Promise<void> {
    this.setState('reconnecting');
    for (let attempt = 0; !this.closedByUser; attempt++) {
      try {
        const ws = await this.dial();
        if (this.closedByUser) {
          ws.close(1000);
          return;
        }
        this.adopt(ws);
        this.setState('open');
        return;
      } catch (err) {
        if (err instanceof TunnelAuthError) {
          this.finalize();
          return;
        }
      }
      const backoff = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      await new Promise((resolve) => {
        setTimeout(resolve, backoff * (0.8 + Math.random() * 0.4));
      });
    }
  }

  /**
   * Host sockets rotate onto a fresh connection (and fresh JWT) ahead of the
   * relay's 24h cutoff. The relay hands attached clients over to the successor
   * and closes the old socket as Replaced — which `handleClose` then ignores,
   * since the successor is already `this.ws`. On failure the old socket keeps
   * serving until the cutoff lands us in the normal reconnect path.
   */
  private async rotate(): Promise<void> {
    const current = this.ws;
    if (!current || this.closedByUser) return;
    try {
      const ws = await this.dial();
      if (this.ws !== current || this.closedByUser) {
        ws.close(1000);
        return;
      }
      this.adopt(ws);
    } catch {
      // Includes TunnelAuthError: a dead credential surfaces through the
      // reconnect path at the cutoff rather than tearing down a live tunnel.
    }
  }

  private stopTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.rotateTimer !== null) clearTimeout(this.rotateTimer);
    this.pingTimer = null;
    this.rotateTimer = null;
  }

  private finalize(): void {
    if (this.currentState === 'closed') return;
    this.setState('closed');
    this.inbound.clear();
    this.closed.emit();
  }

  private setState(state: TunnelClientState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateChanged.emit(state);
  }
}
