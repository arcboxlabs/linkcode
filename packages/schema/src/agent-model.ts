import { z } from 'zod';
import { AgentKindSchema } from './common';

/** One switchable model as advertised by an agent's own catalog (id is the vendor-opaque
 * identifier `set-model` accepts; label is the vendor's display name). */
export const AgentModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type AgentModelOption = z.infer<typeof AgentModelOptionSchema>;

/** Per-agent-kind model catalogs; kinds whose adapter advertises none are simply absent. */
export const AgentModelsSchema = z.partialRecord(AgentKindSchema, z.array(AgentModelOptionSchema));
export type AgentModels = z.infer<typeof AgentModelsSchema>;
