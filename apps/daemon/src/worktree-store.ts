import type { WorktreeLeaseRelease, WorktreeStore, WorktreeStoreSnapshot } from '@linkcode/engine';
import { WorktreeUnavailableError } from '@linkcode/engine';
import type { SessionId, WorktreeRecord } from '@linkcode/schema';
import { WorktreeLeaseSchema, WorktreeRecordSchema } from '@linkcode/schema';
import { count, eq } from 'drizzle-orm';
import type { DaemonDatabaseClient } from './db/database';
import { worktreeSessions, worktrees } from './db/schema';

/**
 * SQLite-backed `WorktreeStore` on the daemon's shared graph/session connection, so a lease
 * release and the `deleting` mark it may cause are one transaction. Rows are validated back
 * through the zod schemas on load.
 */
export function createWorktreeStore(db: DaemonDatabaseClient): WorktreeStore {
  return {
    load(): Promise<WorktreeStoreSnapshot> {
      try {
        return Promise.resolve({
          worktrees: db
            .select()
            .from(worktrees)
            .all()
            .map((row) => WorktreeRecordSchema.parse(row)),
          leases: db
            .select()
            .from(worktreeSessions)
            .all()
            .map((row) => WorktreeLeaseSchema.parse(row)),
        });
      } catch (error) {
        return Promise.reject(new Error('Failed to load worktrees', { cause: error }));
      }
    },

    save(record: WorktreeRecord): Promise<void> {
      try {
        db.insert(worktrees)
          .values(record)
          .onConflictDoUpdate({ target: worktrees.worktreePath, set: record })
          .run();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(new Error('Failed to save worktree', { cause: error }));
      }
    },

    delete(worktreePath): Promise<void> {
      try {
        // Leases cascade with the row.
        db.delete(worktrees).where(eq(worktrees.worktreePath, worktreePath)).run();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(new Error('Failed to delete worktree', { cause: error }));
      }
    },

    acquireLease(worktreePath: string, sessionId: SessionId): Promise<void> {
      try {
        db.transaction((tx) => {
          const row = tx
            .select({ state: worktrees.state })
            .from(worktrees)
            .where(eq(worktrees.worktreePath, worktreePath))
            .get();
          if (row === undefined || row.state === 'deleting') {
            throw new WorktreeUnavailableError(worktreePath);
          }
          // Idempotent for the same worktree; the session index refuses a second worktree.
          tx.insert(worktreeSessions)
            .values({ worktreePath, sessionId, createdAt: Date.now() })
            .onConflictDoNothing({
              target: [worktreeSessions.worktreePath, worktreeSessions.sessionId],
            })
            .run();
        });
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(
          error instanceof WorktreeUnavailableError
            ? error
            : new Error('Failed to lease worktree', { cause: error }),
        );
      }
    },

    releaseLease(sessionId: SessionId): Promise<WorktreeLeaseRelease | undefined> {
      try {
        const released = db.transaction((tx) => {
          const lease = tx
            .select({ worktreePath: worktreeSessions.worktreePath })
            .from(worktreeSessions)
            .where(eq(worktreeSessions.sessionId, sessionId))
            .get();
          if (lease === undefined) return;
          tx.delete(worktreeSessions).where(eq(worktreeSessions.sessionId, sessionId)).run();
          const remaining = tx
            .select({ value: count() })
            .from(worktreeSessions)
            .where(eq(worktreeSessions.worktreePath, lease.worktreePath))
            .get();
          const last = (remaining?.value ?? 0) === 0;
          // The `deleting` mark lands with the release: nothing can lease the directory that
          // cleanup is about to remove.
          if (last) {
            tx.update(worktrees)
              .set({ state: 'deleting' })
              .where(eq(worktrees.worktreePath, lease.worktreePath))
              .run();
          }
          return { worktreePath: lease.worktreePath, last };
        });
        return Promise.resolve(released);
      } catch (error) {
        return Promise.reject(new Error('Failed to release worktree lease', { cause: error }));
      }
    },
  };
}
