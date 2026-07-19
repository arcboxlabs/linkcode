import { z } from 'zod';

/** Agent execution plan — mirrors ACP Plan / PlanEntry. */

export const PlanEntryStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type PlanEntryStatus = z.infer<typeof PlanEntryStatusSchema>;

export const PlanEntryPrioritySchema = z.enum(['high', 'medium', 'low']);
export type PlanEntryPriority = z.infer<typeof PlanEntryPrioritySchema>;

export const PlanEntrySchema = z.object({
  content: z.string(),
  priority: PlanEntryPrioritySchema,
  status: PlanEntryStatusSchema,
});
export type PlanEntry = z.infer<typeof PlanEntrySchema>;

export const PlanSchema = z.object({ entries: z.array(PlanEntrySchema) });
export type Plan = z.infer<typeof PlanSchema>;
