import { z } from 'zod';
import { AgentRuntimesSchema } from '../agent-runtime';

/**
 * Agent runtime availability wire variants — which agent CLIs the host can actually spawn,
 * probed once at daemon boot (see agent-runtime.ts). Pull-only like config/workspace.
 */
export const agentRuntimeWireVariants = [
  z.object({ kind: z.literal('agent-runtime.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('agent-runtime.listed'),
    replyTo: z.string().min(1),
    runtimes: AgentRuntimesSchema,
  }),
] as const;
