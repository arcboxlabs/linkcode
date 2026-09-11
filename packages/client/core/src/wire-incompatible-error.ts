import { MIN_COMPATIBLE_WIRE_VERSION, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';

/** Which side of a wire skew is behind. */
export type WireIncompatibilityRemedy = 'update-host' | 'update-app';

/**
 * The two builds on a connection do not overlap on the wire. A handshake fails with this instead of
 * a timeout, and it cannot heal by retrying: the connection controller stops on it at once so a
 * client renders an update state rather than "host unavailable".
 */
export class WireIncompatibleError extends Error {
  override readonly name = 'WireIncompatibleError';

  constructor(
    readonly remedy: WireIncompatibilityRemedy,
    readonly peerVersion: number,
    readonly peerMinCompatible: number,
  ) {
    super(
      remedy === 'update-host'
        ? `LinkCodeClient: host speaks wire v${peerVersion}, older than the v${MIN_COMPATIBLE_WIRE_VERSION} this build needs — update the host`
        : `LinkCodeClient: this build speaks wire v${WIRE_PROTOCOL_VERSION}, older than the v${peerMinCompatible} the host needs — update this app`,
    );
  }
}
