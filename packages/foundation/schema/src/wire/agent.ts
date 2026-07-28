import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema } from '../model/agent';
import { SessionIdSchema } from '../model/primitives';
import { WireRequestIdSchema } from './request';

/** Live agent-session data-plane variants. */
export const agentWireVariants = [
  z.object({
    kind: z.literal('agent.input'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    input: AgentInputSchema,
  }),
  z.object({ kind: z.literal('agent.event'), sessionId: SessionIdSchema, event: AgentEventSchema }),
] as const;
