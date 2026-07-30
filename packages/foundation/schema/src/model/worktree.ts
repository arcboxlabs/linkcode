import { z } from 'zod';
import { SessionIdSchema, TimestampSchema } from './primitives';

export const WorktreeStateSchema = z.enum(['active', 'orphaned']);
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/** Durable ownership record for a LinkCode-managed git worktree. */
export const WorktreeRecordSchema = z.object({
  worktreePath: z.string().min(1),
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  sessionId: SessionIdSchema,
  createdAt: TimestampSchema,
  state: WorktreeStateSchema,
});
export type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;
