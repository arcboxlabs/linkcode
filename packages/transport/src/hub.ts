import type { WireMessage } from '@linkcode/schema';
import { Listeners } from './transport';
import type { Transport, Unsubscribe } from './transport';

/**
 * Hub: composes many client connections into the single `Transport` the daemon's `Host` consumes.
 *
 * Outbound (`send`) is **broadcast** to every connected client, so all devices attached to the daemon see
 * the same `agent.event` stream (multi-device view). Inbound from any client is merged into one stream for
 * the Host. Per-client routing of replies is handled by correlation ids in the schema (`replyTo`,
 * `requestId`) — the Hub itself stays connection-agnostic (PLAN §2.6).
 */
export class Hub implements Transport {
  private readonly conns = new Set<Transport>();
  private readonly unsubs = new Map<Transport, Unsubscribe>();
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();

  /** Register a client connection; its inbound messages are forwarded to the Host. */
  addConnection(conn: Transport): void {
    if (this.conns.has(conn)) return;
    this.conns.add(conn);
    this.unsubs.set(
      conn,
      conn.onMessage((msg) => this.inbound.emit(msg)),
    );
  }

  /** Drop a client connection (e.g. on socket close). */
  removeConnection(conn: Transport): void {
    this.unsubs.get(conn)?.();
    this.unsubs.delete(conn);
    this.conns.delete(conn);
  }

  /** Number of currently attached clients. */
  get size(): number {
    return this.conns.size;
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  /** Broadcast to every attached client; one failing connection never blocks the others. */
  send(msg: WireMessage): void {
    for (const conn of this.conns) {
      try {
        void Promise.resolve(conn.send(msg)).catch(() => {
          // A dead/closing socket shouldn't break the broadcast; it will be removed on its close event.
        });
      } catch {
        // A dead/closing socket shouldn't break the broadcast; it will be removed on its close event.
      }
    }
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    for (const conn of this.conns) {
      void Promise.resolve(conn.close()).catch(() => {
        // Closing is best-effort during daemon shutdown.
      });
    }
    for (const unsub of this.unsubs.values()) unsub();
    this.conns.clear();
    this.unsubs.clear();
    this.inbound.clear();
    this.closed.emit();
  }
}
