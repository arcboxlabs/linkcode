import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { Listeners, type Transport, type Unsubscribe } from './transport';

/**
 * LocalTransport: local direct-connection (in-process / over IPC) implementation (PLAN §4.4).
 * Used when PC / Web connect locally to a host in the same process or on the same machine.
 * Use `createLocalTransportPair()` to obtain a pair of endpoints that loop back to each other.
 */
export class LocalTransport implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private peer: LocalTransport | null = null;
  private connected = false;

  /** @internal Connected at both ends by createLocalTransportPair. */
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
    // Trust-boundary validation: validate against the contract even for local direct connections, to catch schema drift in the implementation layer.
    const parsed = parseWireMessage(msg);
    if (!parsed.success)
      throw new Error(`LocalTransport: invalid WireMessage: ${parsed.error.message}`);
    const { data } = parsed;
    // Deliver asynchronously to simulate the transport boundary and avoid synchronous reentrancy.
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

/** Create a pair of interconnected local transports: `[clientSide, hostSide]`. */
export function createLocalTransportPair(): [LocalTransport, LocalTransport] {
  const a = new LocalTransport();
  const b = new LocalTransport();
  a._link(b);
  b._link(a);
  return [a, b];
}
