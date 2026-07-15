import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { Transport, TransportServer, Unsubscribe } from './transport';
import { Listeners } from './transport';
import type { TunnelClientOptions, TunnelClientState, TunnelPeer } from './tunnel-client';
import { TunnelClient } from './tunnel-client';

export type TunnelTransportOptions = TunnelClientOptions & { role: 'client' };
export type TunnelTransportServerOptions = Omit<TunnelClientOptions, 'role'>;

/**
 * TunnelTransport: a {@link Transport} carried through the HQ tunnel relay.
 * Remote clients (mobile, eventually desktop) dial this transport. The daemon
 * uses {@link TunnelTransportServer}, which exposes every relay-attested peer
 * as a distinct Hub connection.
 *
 * This layer is only the WireMessage seam (zod at the trust boundary, JSON
 * serialization); connection mechanics — handshake, liveness pings, sub-1MiB
 * chunking, reconnection with fresh tokens, host socket rotation — live in
 * {@link TunnelClient}. Note that `onClose` fires on *permanent* closure
 * only; transient drops reconnect internally.
 */
export class TunnelTransport implements Transport {
  private readonly client: TunnelClient;
  private readonly inbound = new Listeners<WireMessage>();

  constructor(opts: TunnelTransportOptions) {
    this.client = new TunnelClient(opts);
    this.client.onMessage((message) => {
      let raw: unknown;
      try {
        raw = JSON.parse(message);
      } catch {
        return; // Not JSON, discard
      }
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
      // Per the contract, discard on validation failure; never leak unvalidated data to upper layers.
    });
    this.client.onClose(() => this.inbound.clear());
  }

  /** Connection detail for status surfaces (daemon logs, connection UI). */
  get connectionState(): TunnelClientState {
    return this.client.state;
  }

  onStateChange(cb: (state: TunnelClientState) => void): Unsubscribe {
    return this.client.onStateChange(cb);
  }

  connect(): Promise<void> {
    return this.client.connect();
  }

  send(msg: WireMessage): void {
    const parsed = parseWireMessage(msg);
    if (!parsed.success) {
      throw new Error(`TunnelTransport: invalid WireMessage: ${parsed.error.message}`);
    }
    this.client.send(JSON.stringify(parsed.data));
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.client.onClose(cb);
  }

  close(): void {
    this.client.close();
  }
}

class TunnelPeerTransport implements Transport {
  private readonly inbound = new Listeners<WireMessage>();
  private readonly closed = new Listeners<void>();
  private ended = false;

  constructor(private readonly peer: TunnelPeer) {
    peer.onMessage((message) => {
      let raw: unknown;
      try {
        raw = JSON.parse(message);
      } catch {
        return;
      }
      const parsed = parseWireMessage(raw);
      if (parsed.success) this.inbound.emit(parsed.data);
    });
    peer.onClose(() => this.finish());
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: WireMessage): void {
    const parsed = parseWireMessage(msg);
    if (!parsed.success) {
      throw new Error(`TunnelPeerTransport: invalid WireMessage: ${parsed.error.message}`);
    }
    this.peer.send(JSON.stringify(parsed.data));
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.closed.add(cb);
  }

  close(): void {
    this.finish();
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.inbound.clear();
    this.closed.emit();
  }
}

/** Host-side tunnel uplink surfaced as one virtual Transport per remote peer. */
export class TunnelTransportServer implements TransportServer {
  private readonly client: TunnelClient;
  private readonly connections = new Listeners<Transport>();

  constructor(opts: TunnelTransportServerOptions) {
    this.client = new TunnelClient({ ...opts, role: 'host' });
    this.client.onPeer((peer) => this.connections.emit(new TunnelPeerTransport(peer)));
    this.client.onClose(() => this.connections.clear());
  }

  get connectionState(): TunnelClientState {
    return this.client.state;
  }

  onStateChange(cb: (state: TunnelClientState) => void): Unsubscribe {
    return this.client.onStateChange(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    return this.client.onClose(cb);
  }

  connect(): Promise<void> {
    return this.client.connect();
  }

  onConnection(cb: (conn: Transport) => void): Unsubscribe {
    return this.connections.add(cb);
  }

  close(): Promise<void> {
    this.client.close();
    this.connections.clear();
    return Promise.resolve();
  }
}
