import { z } from 'zod';
import { MessageIdSchema, TimestampSchema } from '../model/primitives';
import { WIRE_PAYLOAD_KINDS, WirePayloadSchema } from './payload';

/**
 * Wire protocol: the envelope the transport layer transmits; local (LocalTransport) and tunnel
 * (WsTransport) share the same format. Validate with zod at the trust boundary both before
 * sending and after receiving (docs/ARCHITECTURE.md, Transport & wire protocol).
 */

/** Stamped on every frame this build sends; bump on any wire schema change. */
export const WIRE_PROTOCOL_VERSION = 71 as const;

/** The oldest `v` this build still accepts. Bump only for a breaking change — a variant or field
 * removed, renamed, or given a new meaning; additive changes leave it alone. */
export const MIN_COMPATIBLE_WIRE_VERSION = 68 as const;

/** Complete wire message: version + unique id + timestamp + payload. */
export const WireMessageSchema = z.object({
  v: z.number().int().min(MIN_COMPATIBLE_WIRE_VERSION),
  id: MessageIdSchema,
  ts: TimestampSchema,
  payload: WirePayloadSchema,
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

/** The envelope alone: `payload` stays unparsed so a single unrecognized `kind` can be dropped
 * without taking its neighbours — or the connection — down with it. */
const WireEnvelopeSchema = z.object({
  v: z.number().int(),
  id: MessageIdSchema,
  ts: TimestampSchema,
  payload: z.unknown(),
});

declare const wireMessageValidated: unique symbol;
/**
 * A WireMessage a transport accepts for send. Minted in exactly two places: here by
 * {@link parseWireMessage} (zod at the receive trust boundary) and by the transport package's
 * `createWireMessage` (typed local construction). The brand keeps raw, unvalidated objects out
 * of the send path without paying a per-frame parse there.
 */
export type ValidatedWireMessage = WireMessage & { readonly [wireMessageValidated]: true };

/** Why a frame was refused. Only `unsupported-version` is fatal to a connection; the rest describe
 * one frame, and `unknown-kind` is the routine cost of talking to a newer peer. */
export type WireParseFailure =
  | { reason: 'malformed-envelope' }
  | { reason: 'unsupported-version'; version: number }
  | { reason: 'unknown-kind'; kind: string }
  | { reason: 'invalid-payload'; kind: string; error: z.ZodError };

export type WireParseResult =
  | { ok: true; message: ValidatedWireMessage }
  | ({ ok: false } & WireParseFailure);

/** Parse + validate an inbound message; success mints the {@link ValidatedWireMessage} brand. */
export function parseWireMessage(input: unknown): WireParseResult {
  const envelope = WireEnvelopeSchema.safeParse(input);
  if (!envelope.success) return { ok: false, reason: 'malformed-envelope' };
  if (envelope.data.v < MIN_COMPATIBLE_WIRE_VERSION) {
    return { ok: false, reason: 'unsupported-version', version: envelope.data.v };
  }

  const kind = payloadKind(envelope.data.payload);
  if (kind === undefined) return { ok: false, reason: 'malformed-envelope' };
  if (!WIRE_PAYLOAD_KINDS.has(kind)) return { ok: false, reason: 'unknown-kind', kind };

  const payload = WirePayloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) return { ok: false, reason: 'invalid-payload', kind, error: payload.error };
  return {
    ok: true,
    message: { ...envelope.data, payload: payload.data } as ValidatedWireMessage,
  };
}

function payloadKind(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const kind = (payload as { kind?: unknown }).kind;
  return typeof kind === 'string' ? kind : undefined;
}
