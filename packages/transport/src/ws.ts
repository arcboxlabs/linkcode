import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { WireConnection } from './transport';

export interface WsTransportOptions {
  url: string;
  /** Inject a WebSocket implementation (for older Node / testing); defaults to the global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * WsTransport: remote implementation via a Server tunnel (docs/ARCHITECTURE.md#packages--repo-layout).
 * Reuses the global WebSocket (available in browsers / RN / Node ≥ 22).
 *
 * ❓ Whether serialization details, reconnection, heartbeats, and authentication belong in this layer
 *    is still TBD (see docs/ARCHITECTURE.md#open-questions) — for now this provides only a minimal
 *    usable implementation; keep-alive merely passes ping/pong through, with no automatic reconnection.
 */
export class WsTransport extends WireConnection {
  private ws: WebSocket | null = null;

  constructor(private readonly opts: WsTransportOptions) {
    super('WsTransport');
  }

  override connect(): Promise<void> {
    const Impl = nullthrow(
      this.opts.WebSocketImpl ?? getGlobalWebSocket(),
      'WsTransport: no WebSocket implementation available',
    );

    const ws = new Impl(this.opts.url);
    this.ws = ws;
    this.armClosedListener();

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

  protected sendBytes(msg: WireMessage): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      throw new Error('WsTransport: socket not open');
    }
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.emitClosed();
  }
}

function getGlobalWebSocket(): typeof WebSocket | undefined {
  return Reflect.get(globalThis, 'WebSocket');
}
