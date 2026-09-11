import { z } from 'zod';
import { SessionIdSchema, TimestampSchema } from './primitives';

/** `deleting`: the last lease was released and cleanup owns the directory — no new lease lands. */
export const WorktreeStateSchema = z.enum(['active', 'orphaned', 'deleting']);
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/** Durable record of a LinkCode-managed git worktree; the sessions holding it are its leases. */
export const WorktreeRecordSchema = z.object({
  worktreePath: z.string().min(1),
  repoRoot: z.string().min(1),
  branch: z.string().min(1),
  createdAt: TimestampSchema,
  state: WorktreeStateSchema,
});
export type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;

/** A session's hold on a managed worktree. A worktree lives while any lease does; a fork shares
 * its source's, and releasing the last one marks the worktree `deleting` before any filesystem
 * work. A session holds at most one. */
export const WorktreeLeaseSchema = z.object({
  worktreePath: z.string().min(1),
  sessionId: SessionIdSchema,
  createdAt: TimestampSchema,
});
export type WorktreeLease = z.infer<typeof WorktreeLeaseSchema>;
