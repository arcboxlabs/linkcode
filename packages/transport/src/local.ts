import type { ValidatedWireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import { invariant } from 'foxts/guard';
import type { Transport, Unsubscribe } from './transport';
import { Listeners } from './transport';

/** Local direct-connection (in-process / over IPC) Transport. Use `createLocalTransportPair()`
 * to obtain a pair of endpoints that loop back to each other. */
export class LocalTransport implements Transport {
  private readonly inbound = new Listeners<ValidatedWireMessage>();
  private readonly closed = new Listeners<void>();
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

  send(msg: ValidatedWireMessage): void {
    if (!this.connected) throw new Error('LocalTransport: send before connect()');
    invariant(this.peer, 'LocalTransport: not linked to a peer');
    // The one transport that still parses on send: tests and the dev-mock host run on
    // LocalTransport, so schema drift behind the ValidatedWireMessage brand fails loudly here.
    const parsed = parseWireMessage(msg);
    if (!parsed.success) {
      throw new Error(`LocalTransport: invalid WireMessage: ${parsed.error.message}`);
    }
    const { data } = parsed;
    // Deliver asynchronously to simulate the transport boundary and avoid synchronous reentrancy.
    queueMicrotask(() => this.peer?.inbound.emit(data));
  }

  onMessage(cb: (msg: ValidatedWireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.inbound.clear();
    this.peer = null;
    if (wasConnected) this.closed.emit();
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
