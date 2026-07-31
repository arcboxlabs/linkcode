import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorktreeStore } from '@linkcode/engine';
import type { WorktreeRecord } from '@linkcode/schema';
import { WorktreeRecordSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { worktrees } from './db/schema';

export function createWorktreeStore(dbPath: string): WorktreeStore {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Sqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

  return {
    load(): Promise<WorktreeRecord[]> {
      return Promise.resolve(
        db
          .select()
          .from(worktrees)
          .all()
          .map((row) => WorktreeRecordSchema.parse(row)),
      );
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
      db.delete(worktrees).where(eq(worktrees.worktreePath, worktreePath)).run();
      return Promise.resolve();
    },
  };
}
