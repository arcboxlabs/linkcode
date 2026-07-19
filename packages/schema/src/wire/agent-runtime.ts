import { z } from 'zod';
import { AgentRuntimesSchema } from '../model/agent-runtime';

/**
 * Agent runtime availability wire variants — which agent CLIs the host can actually spawn (see
 * agent-runtime.ts). Pulled via list/listed; a post-boot change re-probes and pushes the fresh
 * snapshot as `agent-runtime.changed` (broadcast, no correlation) so boot snapshots don't go stale.
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
