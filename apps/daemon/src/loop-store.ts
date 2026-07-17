import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoopStore } from '@linkcode/engine';
import type { LoopId, LoopIteration, LoopRecord } from '@linkcode/schema';
import { LoopIterationSchema, LoopRecordSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loopIterations, loops } from './db/schema';

type LoopRow = typeof loops.$inferSelect;
type LoopIterationRow = typeof loopIterations.$inferSelect;

/**
 * SQLite-backed `LoopStore` (drizzle over better-sqlite3), sharing the daemon's registry database at
 * `~/.linkcode/daemon.db`. Rows are validated back through `LoopRecordSchema`/`LoopIterationSchema` on
 * load — the zod schema stays the contract; the tables are just its storage shape. A row that fails
 * validation is dropped and logged rather than blanking the rest. Live logs are not persisted.
 */
export function createLoopStore(dbPath: string): LoopStore {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Sqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

  return {
    load(): Promise<LoopRecord[]> {
      return Promise.resolve(parseAll(db.select().from(loops).all(), toLoop));
    },

    save(loop: LoopRecord): Promise<void> {
      const row = toLoopRow(loop);
      db.insert(loops).values(row).onConflictDoUpdate({ target: loops.loopId, set: row }).run();
      return Promise.resolve();
    },

    delete(loopId: LoopId): Promise<void> {
      // Iterations cascade via the foreign key.
      db.delete(loops).where(eq(loops.loopId, loopId)).run();
      return Promise.resolve();
    },

    loadIterations(loopId: LoopId): Promise<LoopIteration[]> {
      const rows = db
        .select()
        .from(loopIterations)
        .where(eq(loopIterations.loopId, loopId))
        .orderBy(asc(loopIterations.index))
        .all();
      return Promise.resolve(parseAll(rows, toIteration));
    },

    saveIteration(iteration: LoopIteration): Promise<void> {
      const row = toIterationRow(iteration);
      db.insert(loopIterations)
        .values(row)
        .onConflictDoUpdate({
          target: [loopIterations.loopId, loopIterations.index],
          set: row,
        })
        .run();
      return Promise.resolve();
    },

    loadRunning(): Promise<LoopRecord[]> {
      const rows = db.select().from(loops).where(eq(loops.status, 'running')).all();
      return Promise.resolve(parseAll(rows, toLoop));
    },
  };
}

/** Parse each row through its schema; drop and log a row that fails rather than failing the load. */
function parseAll<Row, T>(rows: Row[], parse: (row: Row) => T): T[] {
  const parsed: T[] = [];
  for (const row of rows) {
    try {
      parsed.push(parse(row));
    } catch (err) {
      console.error('Dropping malformed loop row:', err);
    }
  }
  return parsed;
}

function toLoopRow(loop: LoopRecord): typeof loops.$inferInsert {
  return {
    loopId: loop.loopId,
    specJson: JSON.stringify(loop.spec),
    status: loop.status,
    iterationCount: loop.iterationCount,
    error: loop.error ?? null,
    summary: loop.summary ?? null,
    startedAt: loop.startedAt,
    updatedAt: loop.updatedAt,
    endedAt: loop.endedAt ?? null,
  };
}

function toLoop(row: LoopRow): LoopRecord {
  return LoopRecordSchema.parse({
    loopId: row.loopId,
    spec: JSON.parse(row.specJson),
    status: row.status,
    iterationCount: row.iterationCount,
    error: row.error ?? undefined,
    summary: row.summary ?? undefined,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    endedAt: row.endedAt ?? undefined,
  });
}

function toIterationRow(iteration: LoopIteration): typeof loopIterations.$inferInsert {
  return {
    loopId: iteration.loopId,
    index: iteration.index,
    status: iteration.status,
    workerSessionId: iteration.workerSessionId ?? null,
    verifierSessionId: iteration.verifierSessionId ?? null,
    checksJson: JSON.stringify(iteration.checks),
    verdictJson: iteration.verdict ? JSON.stringify(iteration.verdict) : null,
    error: iteration.error ?? null,
    startedAt: iteration.startedAt,
    endedAt: iteration.endedAt ?? null,
  };
}

function toIteration(row: LoopIterationRow): LoopIteration {
  return LoopIterationSchema.parse({
    loopId: row.loopId,
    index: row.index,
    status: row.status,
    workerSessionId: row.workerSessionId ?? undefined,
    verifierSessionId: row.verifierSessionId ?? undefined,
    checks: JSON.parse(row.checksJson),
    verdict: row.verdictJson ? JSON.parse(row.verdictJson) : undefined,
    error: row.error ?? undefined,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
  });
}
