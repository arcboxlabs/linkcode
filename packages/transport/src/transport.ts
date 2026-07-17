import type { WireMessage, WirePayload } from '@linkcode/schema';
import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { once } from 'foxts/once';

/** Unsubscribe. */
export type Unsubscribe = () => void;

/**
 * The communication protocol layer (docs/ARCHITECTURE.md#key-contracts, #core-principles):
 * responsible only for "how messages are transmitted" — the payload is always the schema-defined
 * WireMessage, and upper layers never know whether the connection is local or a tunnel.
 */
export interface Transport {
  connect(): Promise<void>;
  /** Send a wire message (implementations should run zod validation before sending). */
  send(msg: WireMessage): void | Promise<void>;
  /** Subscribe to inbound messages (implementations should run zod validation before delivery). */
  onMessage(cb: (msg: WireMessage) => void): Unsubscribe;
  /** Subscribe to connection close. */
  onClose(cb: () => void): Unsubscribe;
  close(): void | Promise<void>;
}

/** A listener that accepts client connections and presents each one as a Transport. */
export interface TransportServer {
  /** Subscribe to newly accepted client connections. Register before clients connect. */
  onConnection(cb: (conn: Transport) => void): Unsubscribe;
  close(): Promise<void>;
}

let __seq = 0;

/** Build a wire message with a version / id / timestamp envelope. */
export function createWireMessage(payload: WirePayload): WireMessage {
  __seq += 1;
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: `${Date.now().toString(36)}-${__seq.toString(36)}` as WireMessage['id'],
    ts: Date.now(),
    payload,
  };
}

/** A simple set of listeners, reused across transport implementations. */
export class Listeners<T> {
  private readonly set = new Set<(value: T) => void>();

  add(cb: (value: T) => void): Unsubscribe {
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
 * Base for the four wire-carried `Transport` implementations (ws / ws-server / socket-io /
 * socket-io-server): factors out the listener bookkeeping, the deferred `emitClosed` arming, and
 * the parse-or-throw `send()` gate they all repeat. Binding timing is the load-bearing difference:
 * client transports create their socket in an overridden `connect()` and arm `emitClosed` there;
 * server-side connections already hold a live socket at construction, so they arm it in their
 * constructor and keep the inherited default `connect()`.
 */
export abstract class WireConnection implements Transport {
  protected readonly inbound = new Listeners<WireMessage>();
  protected readonly closed = new Listeners<void>();
  /** No-op until `armClosedListener()` runs; closing before that point is a safe no-op. */
  protected emitClosed: () => void = noop;

  protected constructor(
    /** Used to prefix thrown/error messages, e.g. `WsTransport: invalid WireMessage: ...`. */
    private readonly label: string,
  ) {}

  /** Default: the socket is already open when handed to us. Client transports override this. */
  connect(): Promise<void> {
    return Promise.resolve();
  }

  abstract close(): void | Promise<void>;

  /** Push already-validated bytes onto the underlying socket (or drop them if it isn't ready). */
  protected abstract sendBytes(msg: WireMessage): void;

  send(msg: WireMessage): void {
    const parsed = parseWireMessage(msg);
    if (!parsed.success) {
      throw new Error(`${this.label}: invalid WireMessage: ${parsed.error.message}`);
    }
    this.sendBytes(parsed.data);
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  /** Arm `emitClosed` for this connection's lifetime; foxts `once` prewarms by default, so pass `false` to defer it to the first real close. */
  protected armClosedListener(): void {
    this.emitClosed = once((): void => {
      this.inbound.clear();
      this.closed.emit();
    }, false);
  }
}
