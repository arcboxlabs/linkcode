import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkspaceStore } from '@linkcode/engine';
import type { WorkspaceRecord } from '@linkcode/schema';
import { WorkspaceRecordSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { workspaces } from './db/schema';

type WorkspaceRow = typeof workspaces.$inferSelect;

/**
 * SQLite-backed `WorkspaceStore` (drizzle over better-sqlite3), sharing the daemon's registry
 * database at `~/.linkcode/daemon.db`. Rows are validated back through `WorkspaceRecordSchema` on
 * load — the zod schema stays the contract; the table is just its storage shape.
 */
export function createWorkspaceStore(dbPath: string): WorkspaceStore {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Sqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

  return {
    load(): Promise<WorkspaceRecord[]> {
      const rows = db.select().from(workspaces).all();
      return Promise.resolve(rows.map(toRecord));
    },

    save(record: WorkspaceRecord): Promise<void> {
      const row = toRow(record);
      db.insert(workspaces)
        .values(row)
        .onConflictDoUpdate({ target: workspaces.workspaceId, set: row })
        .run();
      return Promise.resolve();
    },

    delete(workspaceId): Promise<void> {
      db.delete(workspaces).where(eq(workspaces.workspaceId, workspaceId)).run();
      return Promise.resolve();
    },
  };
}

function toRow(record: WorkspaceRecord): typeof workspaces.$inferInsert {
  return {
    workspaceId: record.workspaceId,
    cwd: record.cwd,
    name: record.name ?? null,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function toRecord(row: WorkspaceRow): WorkspaceRecord {
  return WorkspaceRecordSchema.parse({
    workspaceId: row.workspaceId,
    cwd: row.cwd,
    name: row.name ?? undefined,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  });
}
