import type { WireMessage } from '@linkcode/schema';
import { parseWireMessage } from '@linkcode/schema';
import type { Transport, Unsubscribe } from './transport';
import { Listeners } from './transport';
import type { TunnelClientOptions, TunnelClientState } from './tunnel-client';
import { TunnelClient } from './tunnel-client';

export type TunnelTransportOptions = TunnelClientOptions;

/**
 * TunnelTransport: a {@link Transport} carried through the HQ tunnel relay.
 * The daemon dials it once as `role: 'host'`; every remote client (mobile,
 * eventually desktop) dials `role: 'client'` for the same host id.
 *
 * The relay merges all client traffic onto the host's single socket and
 * broadcasts host traffic to every client — exactly the Hub's own fan-out
 * semantics, so the daemon attaches this transport to its Hub as one more
 * client connection and reply routing keeps working via the schema's
 * correlation ids (`clientReqId` → `replyTo`).
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
