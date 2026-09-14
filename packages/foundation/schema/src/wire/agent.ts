import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema } from '../model/agent';
import { RunIdSchema, SessionIdSchema, TurnIdSchema } from '../model/primitives';
import { WireRequestIdSchema } from './request';

/** Live agent-session data-plane variants. */
export const agentWireVariants = [
  z.object({
    kind: z.literal('agent.input'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    input: AgentInputSchema,
  }),
  /** The turn/run attribution and `(epoch, seq)` position stay OPTIONAL until the compatibility
   * floor moves past their introduction — required fields on an existing kind are a breaking
   * change (Invariant 1). Clients feature-detect via the peer's wire version. */
  z.object({
    kind: z.literal('agent.event'),
    sessionId: SessionIdSchema,
    runId: RunIdSchema.optional(),
    turnId: TurnIdSchema.optional(),
    epoch: z.number().int().nonnegative().optional(),
    seq: z.number().int().nonnegative().optional(),
    event: AgentEventSchema,
  }),
] as const;
