import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema, StartOptionsSchema } from './agent';
import { MessageIdSchema, SessionIdSchema, TimestampSchema } from './common';

/**
 * Wire protocol: the envelope actually transmitted by the transport layer (PLAN §6).
 * Local direct connection (LocalTransport) and remote tunnel (WsTransport) share the same format (PLAN §2.6).
 * Validate with zod at the trust boundary both before sending and after receiving (PLAN §2.1).
 * 🔧 Proposed starting point.
 */

export const WIRE_PROTOCOL_VERSION = 1 as const;

/** Envelope payload: a discriminated union keyed by `kind`. */
export const WirePayloadSchema = z.discriminatedUnion('kind', [
  // ── Session control ──
  z.object({ kind: z.literal('session.start'), opts: StartOptionsSchema }),
  z.object({ kind: z.literal('session.started'), sessionId: SessionIdSchema }),
  z.object({ kind: z.literal('session.stop'), sessionId: SessionIdSchema }),

  // ── Data plane ──
  z.object({ kind: z.literal('agent.input'), sessionId: SessionIdSchema, input: AgentInputSchema }),
  z.object({ kind: z.literal('agent.event'), sessionId: SessionIdSchema, event: AgentEventSchema }),

  // ── Keep-alive ──
  z.object({ kind: z.literal('ping') }),
  z.object({ kind: z.literal('pong') }),
]);
export type WirePayload = z.infer<typeof WirePayloadSchema>;

/** Complete wire message: version + unique id + timestamp + payload. */
export const WireMessageSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  id: MessageIdSchema,
  ts: TimestampSchema,
  payload: WirePayloadSchema,
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

/** Parse + validate an inbound message; on failure returns the zod SafeParse result. */
export function parseWireMessage(input: unknown): z.SafeParseReturnType<unknown, WireMessage> {
  return WireMessageSchema.safeParse(input);
}
