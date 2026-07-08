import { z } from 'zod';
import { AgentModelsSchema } from '../agent-model';

/**
 * Agent model-catalog wire variants — which models each agent's own catalog advertises
 * (see agent-model.ts). Pull-only like agent-runtime; the host probes lazily on first
 * request (spawning a CLI where the catalog lives behind one) and caches per boot.
 */
export const agentModelWireVariants = [
  z.object({ kind: z.literal('agent-model.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('agent-model.listed'),
    replyTo: z.string().min(1),
    models: AgentModelsSchema,
  }),
] as const;
