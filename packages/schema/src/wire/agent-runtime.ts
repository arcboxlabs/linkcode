import { z } from 'zod';
import { AgentRuntimesSchema } from '../agent-runtime';

/**
 * Agent runtime availability wire variants — which agent CLIs the host can actually spawn,
 * probed at daemon boot (see agent-runtime.ts). Pulled via list/listed; a managed install
 * completing after boot re-probes and pushes the fresh snapshot as `agent-runtime.changed`
 * (broadcast, no correlation) so clients don't serve a stale boot snapshot forever.
 */
export const agentRuntimeWireVariants = [
  z.object({ kind: z.literal('agent-runtime.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('agent-runtime.listed'),
    replyTo: z.string().min(1),
    runtimes: AgentRuntimesSchema,
  }),
  z.object({
    kind: z.literal('agent-runtime.changed'),
    runtimes: AgentRuntimesSchema,
  }),
] as const;
