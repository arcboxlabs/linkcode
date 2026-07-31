import type { WirePayload } from '@linkcode/schema';
import { MIN_COMPATIBLE_WIRE_VERSION, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';

/** The handshake answer, stating this build's version range so a peer can name a skew rather than
 * time out against it. */
export function pong(): WirePayload {
  return {
    kind: 'pong',
    version: WIRE_PROTOCOL_VERSION,
    minCompatible: MIN_COMPATIBLE_WIRE_VERSION,
  };
}
