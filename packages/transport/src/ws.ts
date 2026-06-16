import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { Listeners, type Transport, type Unsubscribe } from './transport';

export interface WsTransportOptions {
  url: string;
  /** 注入 WebSocket 实现（Node 旧版 / 测试用）；默认用全局 WebSocket。 */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * WsTransport：经 Server 隧道的远程实现（PLAN §4.4）。
 * 复用全局 WebSocket（浏览器 / RN / Node ≥ 22 均可用）。
 *
 * ❓ 序列化细节、重连、心跳、鉴权是否在此分层尚待确认（PLAN §10.6）——
 *    当前仅提供最小可用实现，保活只透传 ping/pong，不做自动重连。
 */
export class WsTransport implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private ws: WebSocket | null = null;

  constructor(private readonly opts: WsTransportOptions) {}

  connect(): Promise<void> {
    const Impl = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!Impl) throw new Error('WsTransport: no WebSocket implementation available');

    const ws = new Impl(this.opts.url);
    this.ws = ws;

    ws.addEventListener('message', (ev: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return; // 非 JSON，丢弃
      }
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // 校验失败按契约直接丢弃，不向上层泄漏未校验数据。
    });

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

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.inbound.clear();
  }
}
