import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { Listeners, type Transport, type Unsubscribe } from './transport';

/**
 * LocalTransport：本机直连（进程内 / IPC 内）实现（PLAN §4.4）。
 * 用于 PC / Web 在本地直连同进程或同机的 host。
 * 通过 `createLocalTransportPair()` 得到一对互相回环的端点。
 */
export class LocalTransport implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private peer: LocalTransport | null = null;
  private connected = false;

  /** @internal 由 createLocalTransportPair 连接两端。 */
  _link(peer: LocalTransport): void {
    this.peer = peer;
  }

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  send(msg: WireMessage): void {
    if (!this.connected) throw new Error('LocalTransport: send before connect()');
    if (!this.peer) throw new Error('LocalTransport: not linked to a peer');
    // 信任边界校验：即使本机直连也按契约校验，发现实现层的 schema 漂移。
    const parsed = parseWireMessage(msg);
    if (!parsed.success)
      throw new Error(`LocalTransport: invalid WireMessage: ${parsed.error.message}`);
    const { data } = parsed;
    // 异步交付，模拟传输边界、避免同步重入。
    queueMicrotask(() => this.peer?.inbound.emit(data));
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  close(): void {
    this.connected = false;
    this.inbound.clear();
    this.peer = null;
  }
}

/** 创建一对互联的本地 transport：`[clientSide, hostSide]`。 */
export function createLocalTransportPair(): [LocalTransport, LocalTransport] {
  const a = new LocalTransport();
  const b = new LocalTransport();
  a._link(b);
  b._link(a);
  return [a, b];
}
