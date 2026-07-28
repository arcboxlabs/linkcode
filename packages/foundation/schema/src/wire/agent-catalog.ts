import { z } from 'zod';
import { AgentStartCatalogSchema } from '../model/agent';
import { AgentKindSchema } from '../model/primitives';
import { WireRequestIdSchema } from './request';

export const agentCatalogWireVariants = [
  z.object({
    kind: z.literal('agent.catalog'),
    clientReqId: WireRequestIdSchema,
    agentKind: AgentKindSchema,
    cwd: z.string().optional(),
  }),
  z.object({
    kind: z.literal('agent.cataloged'),
    replyTo: WireRequestIdSchema,
    catalog: AgentStartCatalogSchema,
  }),
] as const;
