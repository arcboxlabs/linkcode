import { z } from 'zod';
import { MessageIdSchema, TimestampSchema } from '../model/primitives';
import { WirePayloadSchema } from './payload';

/**
 * Wire protocol: the envelope the transport layer transmits; local (LocalTransport) and tunnel
 * (WsTransport) share the same format. Validate with zod at the trust boundary both before
 * sending and after receiving (docs/ARCHITECTURE.md, Transport & wire protocol).
 */

// Bump on every wire schema change; mismatched peers silently discard all frames (Invariant 1).
export const WIRE_PROTOCOL_VERSION = 65 as const;

/** Complete wire message: version + unique id + timestamp + payload. */
export const WireMessageSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  id: MessageIdSchema,
  ts: TimestampSchema,
  payload: WirePayloadSchema,
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

declare const wireMessageValidated: unique symbol;
/**
 * A WireMessage a transport accepts for send. Minted in exactly two places: here by
 * {@link parseWireMessage} (zod at the receive trust boundary) and by the transport package's
 * `createWireMessage` (typed local construction). The brand keeps raw, unvalidated objects out
 * of the send path without paying a per-frame parse there.
 */
export type ValidatedWireMessage = WireMessage & { readonly [wireMessageValidated]: true };

/** Parse + validate an inbound message; success mints the {@link ValidatedWireMessage} brand. */
export function parseWireMessage(input: unknown): z.ZodSafeParseResult<ValidatedWireMessage> {
  return WireMessageSchema.safeParse(input) as z.ZodSafeParseResult<ValidatedWireMessage>;
}
