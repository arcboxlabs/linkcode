import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { WireConnection } from './transport';

export interface WsReconnectOptions {
  /** First backoff delay, in ms. Default 500. */
  baseMs?: number;
  /** Ceiling on the backoff delay, in ms. Default 30_000. */
  maxMs?: number;
  /** Multiplier applied per consecutive attempt. Default 2. */
  factor?: number;
  /** Give up (terminal close) after this many consecutive failed reconnects. Default Infinity. */
  maxRetries?: number;
}

export interface WsTransportOptions {
  url: string;
  /** Auth-token provider for the tunnel handshake, appended as `access_token` on every
   * (re)connect. A function so a reconnect after the short-lived tunnel JWT expires re-mints a
   * fresh one; omit for unauthenticated endpoints. */
  getToken?: () => string | Promise<string>;
  /** WebSocket subprotocol(s) to offer — the cloud tunnel requires its versioned subprotocol. */
  protocols?: string | string[];
  /** Auto-reconnect an *established* connection that drops, with exponential backoff (off by
   * default; `true` uses the defaults). The initial `connect()` never auto-retries, so "connect
   * rejects when the host is unreachable" still holds. While reconnecting, `onClose` stays
   * silent — it fires only on a terminal close (`close()` or the retry budget exhausted). */
  reconnect?: WsReconnectOptions | boolean;
  /** Inject a WebSocket implementation (for older Node / testing); defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

const RECONNECT_DEFAULTS: Required<WsReconnectOptions> = {
  baseMs: 500,
  maxMs: 30000,
  factor: 2,
  maxRetries: Number.POSITIVE_INFINITY,
};

/**
 * Remote Transport over the global WebSocket (browsers / RN / Node ≥ 22). Carries the tunnel
 * auth token and, when enabled, transparently reconnects a dropped connection with exponential
 * backoff so upper layers see one continuous session.
 */
export class WsTransport extends WireConnection {
  private ws: WebSocket | null = null;
  /** Set once `close()` is called — stops reconnection and makes late socket events no-ops. */
  private disposed = false;
  /** True after the first successful open; gates reconnect (the initial attempt never auto-retries). */
  private established = false;
  /** Count of consecutive failed reconnects since the last successful open. */
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readonly reconnectOpts: Required<WsReconnectOptions> | null;

  constructor(private readonly opts: WsTransportOptions) {
    super('WsTransport');
    const overrides = opts.reconnect === true ? {} : opts.reconnect;
    this.reconnectOpts = overrides ? { ...RECONNECT_DEFAULTS, ...overrides } : null;
    this.armClosedListener();
  }

  override connect(): Promise<void> {
    this.disposed = false;
    this.established = false;
    this.attempt = 0;
    return new Promise<void>((resolve, reject) => {
      this.settle = { resolve, reject };
      void this.open();
    });
  }

  private async open(): Promise<void> {
    if (this.disposed) return;
    const Impl = nullthrow(
      this.opts.WebSocketImpl ?? getGlobalWebSocket(),
      'WsTransport: no WebSocket implementation available',
    );

    let url: string;
    try {
      url = await this.resolveUrl();
    } catch {
      this.handleDrop(new Error('WsTransport: could not resolve the tunnel token'));
      return;
    }
    // close() can run during the awaited token fetch above, flipping `disposed`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- narrowed away by the await
    if (this.disposed) return;

    const ws = new Impl(url, this.opts.protocols);
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws) return; // superseded by a newer attempt
      this.established = true;
      this.attempt = 0;
      this.settle?.resolve();
      this.settle = null;
    });
    ws.addEventListener('message', (ev: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return; // Not JSON, discard
      }
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });

    // `error` is followed by `close` in browsers/undici, but not on every runtime; route both through
    // a single guarded drop so a socket is only torn down (and reconnection scheduled) once.
    let dropped = false;
    const drop = (): void => {
      if (dropped || this.ws !== ws) return;
      dropped = true;
      this.ws = null;
      this.handleDrop(new Error('WsTransport: connection closed'));
    };
    ws.addEventListener('close', drop, { once: true });
    ws.addEventListener('error', drop);
  }

  private async resolveUrl(): Promise<string> {
    if (!this.opts.getToken) return this.opts.url;
    const token = await this.opts.getToken();
    const url = new URL(this.opts.url);
    url.searchParams.set('access_token', token);
    return url.href;
  }

  private handleDrop(error: Error): void {
    if (this.disposed) return;
    // Initial connect failure (never established): reject and close for good — the first attempt never
    // auto-retries, preserving the caller's "connect rejects if the host is unreachable" contract.
    if (!this.established) {
      this.settle?.reject(error);
      this.settle = null;
      this.emitClosed();
      return;
    }
    // An established connection dropped. Reconnect unless disabled or the retry budget is spent.
    if (!this.reconnectOpts || this.attempt >= this.reconnectOpts.maxRetries) {
      this.emitClosed();
      return;
    }
    const { baseMs, maxMs, factor } = this.reconnectOpts;
    const backoff = Math.min(maxMs, baseMs * factor ** this.attempt);
    // Full jitter on the upper quarter avoids a thundering herd of hosts reconnecting in lockstep.
    const delay = backoff * (1 + Math.random() * 0.25);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  protected sendBytes(msg: WireMessage): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error('WsTransport: socket not open');
    }
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.settle?.reject(new Error('WsTransport: closed'));
    this.settle = null;
    this.emitClosed();
  }
}

function getGlobalWebSocket(): typeof WebSocket | undefined {
  return Reflect.get(globalThis, 'WebSocket');
}
