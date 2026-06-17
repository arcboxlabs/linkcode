import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { Listeners, type Transport, type Unsubscribe } from './transport';

export interface WsTransportOptions {
  url: string;
  /** Inject a WebSocket implementation (for older Node / testing); defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * WsTransport: remote implementation via a Server tunnel (PLAN §4.4).
 * Reuses the global WebSocket (available in browsers / RN / Node ≥ 22).
 *
 * ❓ Whether serialization details, reconnection, heartbeats, and authentication belong in this layer is still TBD (PLAN §10.6) —
 *    for now this provides only a minimal usable implementation; keep-alive merely passes ping/pong through, with no automatic reconnection.
 */
export class WsTransport implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();
  private ws: WebSocket | null = null;
  private isClosed = true;

  constructor(private readonly opts: WsTransportOptions) {}

  connect(): Promise<void> {
    const Impl = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!Impl) throw new Error('WsTransport: no WebSocket implementation available');

    const ws = new Impl(this.opts.url);
    this.ws = ws;
    this.isClosed = false;

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
    ws.addEventListener('close', () => this.emitClosed(), { once: true });

    return new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('WsTransport: connection error')), {
        once: true,
      });
    });
  }

  send(msg: WireMessage): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error('WsTransport: socket not open');
    }
    const parsed = parseWireMessage(msg);
    if (!parsed.success)
      throw new Error(`WsTransport: invalid WireMessage: ${parsed.error.message}`);
    this.ws.send(JSON.stringify(parsed.data));
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.emitClosed();
  }

  private emitClosed(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.inbound.clear();
    this.closed.emit();
  }
}
