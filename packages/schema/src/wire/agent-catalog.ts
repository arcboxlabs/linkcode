import { z } from 'zod';
import { AgentStartCatalogSchema } from '../agent';
import { AgentKindSchema } from '../common';

/**
 * Pre-session picker data for one agent kind — the new-session surface's data source for the
 * model / approval-policy pickers before any session exists. Served from a never-started adapter
 * factory instance (the history-read pattern), so it reflects the machine's local installs/auth.
 */
export const agentCatalogWireVariants = [
  z.object({
    kind: z.literal('agent.catalog'),
    clientReqId: z.string().min(1),
    agentKind: AgentKindSchema,
    /** Workspace the session would start in; affects config-scoped answers (claude settings
     * default tier, opencode per-directory agents). Absent falls back to machine-global scope. */
    cwd: z.string().optional(),
  }),
  z.object({
    kind: z.literal('agent.cataloged'),
    replyTo: z.string().min(1),
    catalog: AgentStartCatalogSchema,
  }),
] as const;
