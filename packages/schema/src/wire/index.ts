import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema } from '../agent';
import { MessageIdSchema, SessionIdSchema, TimestampSchema } from '../common';
import { agentLoginWireVariants } from './agent-login';
import { agentRuntimeWireVariants } from './agent-runtime';
import { artifactWireVariants } from './artifact';
import { configWireVariants } from './config';
import { fileWireVariants } from './file';
import { gitWireVariants } from './git';
import { historyWireVariants } from './history';
import { keepAliveWireVariants } from './keep-alive';
import { loopWireVariants } from './loop';
import { managedAssetWireVariants } from './managed-asset';
import { scheduleWireVariants } from './schedule';
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
 * Wire protocol: the envelope the transport layer transmits; local (LocalTransport) and tunnel
 * (WsTransport) share the same format. Validate with zod at the trust boundary both before
 * sending and after receiving (docs/ARCHITECTURE.md, Transport & wire protocol). The payload
 * union assembles one variant array per resource; `agent.input` / `agent.event` stay inline as a
 * thin pass-through of agent.ts. `agent.event` is broadcast to all attached clients of a session,
 * so request/response control messages correlate via `clientReqId` → `replyTo`.
 */

export const WIRE_PROTOCOL_VERSION = 38 as const;

/** Envelope payload: a discriminated union keyed by `kind`. */
export const WirePayloadSchema = z.discriminatedUnion('kind', [
  ...sessionWireVariants,
  ...historyWireVariants,
  ...configWireVariants,
  ...agentRuntimeWireVariants,
  ...agentLoginWireVariants,
  ...managedAssetWireVariants,
  ...workspaceWireVariants,
  ...gitWireVariants,
  ...fileWireVariants,
  ...scriptWireVariants,
  ...scheduleWireVariants,
  ...loopWireVariants,
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
