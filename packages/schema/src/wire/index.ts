import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema } from '../agent';
import { MessageIdSchema, SessionIdSchema, TimestampSchema } from '../common';
import { agentModelWireVariants } from './agent-model';
import { agentRuntimeWireVariants } from './agent-runtime';
import { artifactWireVariants } from './artifact';
import { configWireVariants } from './config';
import { fileWireVariants } from './file';
import { gitWireVariants } from './git';
import { historyWireVariants } from './history';
import { keepAliveWireVariants } from './keep-alive';
import { scriptWireVariants } from './script';
import { sessionWireVariants } from './session';
import { terminalWireVariants } from './terminal';
import { workspaceWireVariants } from './workspace';

export {
  type AgentHistoryListWireOptions,
  AgentHistoryListWireOptionsSchema,
  type AgentHistoryReadWireOptions,
  AgentHistoryReadWireOptionsSchema,
} from './history';

/**
 * Wire protocol: the envelope actually transmitted by the transport layer. Local direct
 * connection (LocalTransport) and remote tunnel (WsTransport) share the same format. Validate
 * with zod at the trust boundary both before sending and after receiving. See
 * docs/ARCHITECTURE.md's Transport & wire protocol section.
 *
 * The payload union is assembled here from one variant array per resource (session / history /
 * config / workspace / git / file / terminal / keep-alive, each in its own file in this directory);
 * `agent.input` / `agent.event` stay inline since they're a thin pass-through of agent.ts's own
 * contract, with no wire-specific shape of their own.
 *
 * v2: the daemon serves multiple clients, so `agent.event` is broadcast to all attached clients of a
 * session. Request/response control messages carry a correlation id (`clientReqId` → `replyTo`) so the
 * originating client can pair the reply despite the broadcast.
 */

export const WIRE_PROTOCOL_VERSION = 15 as const;

/** Envelope payload: a discriminated union keyed by `kind`. */
export const WirePayloadSchema = z.discriminatedUnion('kind', [
  ...sessionWireVariants,
  ...historyWireVariants,
  ...configWireVariants,
  ...agentRuntimeWireVariants,
  ...agentModelWireVariants,
  ...workspaceWireVariants,
  ...gitWireVariants,
  ...fileWireVariants,
  ...scriptWireVariants,
  ...artifactWireVariants,

  // ── Data plane ──
  z.object({
    kind: z.literal('agent.input'),
    clientReqId: z.string().min(1),
    sessionId: SessionIdSchema,
    input: AgentInputSchema,
  }),
  z.object({ kind: z.literal('agent.event'), sessionId: SessionIdSchema, event: AgentEventSchema }),

  ...terminalWireVariants,
  ...keepAliveWireVariants,
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
export function parseWireMessage(input: unknown): ReturnType<typeof WireMessageSchema.safeParse> {
  return WireMessageSchema.safeParse(input);
}
