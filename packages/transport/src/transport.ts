import type { WireMessage, WirePayload } from '@linkcode/schema';
import { WIRE_PROTOCOL_VERSION } from '@linkcode/schema';

/** Unsubscribe. */
export type Unsubscribe = () => void;

/**
 * transport: the communication protocol layer (PLAN §4.4 / §6).
 * Responsible only for "how messages are transmitted"; what it carries is always the schema-defined WireMessage.
 * Upper layers are unaware whether the underlying connection is a local direct connection or a tunnel (PLAN §2.6).
 */
export interface Transport {
  connect(): Promise<void>;
  /** Send a wire message (implementations should run zod validation before sending). */
  send(msg: WireMessage): void;
  /** Subscribe to inbound messages (implementations should run zod validation before delivery). */
  onMessage(cb: (msg: WireMessage) => void): Unsubscribe;
  close(): void;
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
