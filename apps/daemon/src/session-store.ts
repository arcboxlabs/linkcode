import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionStore } from '@linkcode/engine';
import type { SessionRecord } from '@linkcode/schema';
import { SessionRecordSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sessionRuns, sessions } from './db/schema';

type SessionRow = typeof sessions.$inferSelect;
type RunRow = typeof sessionRuns.$inferSelect;

/**
 * drizzle's migrator decides "already applied?" by comparing each migration's journal `when`
 * (`folderMillis`) against the newest recorded `created_at` — it never looks at the content hash.
 * A migration regenerated during development keeps identical SQL but gets a fresh, larger `when`,
 * so the migrator re-runs it; the resulting non-idempotent DDL (`ALTER TABLE … ADD COLUMN`) then
 * crashes the daemon at boot on a DB that recorded the older timestamp. Since the stored hash is
 * the sha256 of the migration SQL, a recorded hash proves that exact migration already ran — so we
 * realign its `created_at` to the current journal before migrating. Steady state writes nothing;
 * genuinely new migrations (unrecorded hash) still run and still fail loudly on real errors.
 */
function reconcileMigrationLedger(sqlite: Sqlite.Database, migrationsFolder: string): void {
  const hasLedger = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!hasLedger) return; // First boot — nothing has been applied yet.
  const realign = sqlite.prepare(
    'UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ? AND created_at <> ?',
  );
  sqlite.transaction(() => {
    for (const migration of readMigrationFiles({ migrationsFolder })) {
      realign.run(migration.folderMillis, migration.hash, migration.folderMillis);
    }
  })();
}

/**
 * SQLite-backed `SessionStore` (drizzle over better-sqlite3), owning the session registry at
 * `~/.linkcode/daemon.db`. Rows are validated back through `SessionRecordSchema` on load — the
 * zod schema stays the contract; the tables are just its storage shape.
 */
export function createSessionStore(dbPath: string): SessionStore {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Sqlite(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  reconcileMigrationLedger(sqlite, migrationsFolder);
  migrate(db, { migrationsFolder });

  return {
    load(): Promise<SessionRecord[]> {
      const sessionRows = db.select().from(sessions).all();
      const runRows = db
        .select()
        .from(sessionRuns)
        .orderBy(asc(sessionRuns.sessionId), asc(sessionRuns.seq))
        .all();
      const runsBySession = new Map<string, RunRow[]>();
      for (const run of runRows) {
        const bucket = runsBySession.get(run.sessionId);
        if (bucket) bucket.push(run);
        else runsBySession.set(run.sessionId, [run]);
      }
      return Promise.resolve(
        sessionRows.map((row) => toRecord(row, runsBySession.get(row.sessionId) ?? [])),
      );
    },

    save(record: SessionRecord): Promise<void> {
      const row = toSessionRow(record);
      db.transaction((tx) => {
        tx.insert(sessions)
          .values(row)
          .onConflictDoUpdate({ target: sessions.sessionId, set: row })
          .run();
        // Runs are few per session; rewriting them keeps save() a whole-record upsert.
        tx.delete(sessionRuns).where(eq(sessionRuns.sessionId, record.sessionId)).run();
        if (record.runs.length > 0) {
          tx.insert(sessionRuns)
            .values(
              record.runs.map((run, seq) => ({
                sessionId: record.sessionId,
                seq,
                historyId: run.historyId ?? null,
                startedAt: run.startedAt,
                endedAt: run.endedAt ?? null,
              })),
            )
            .run();
        }
      });
      return Promise.resolve();
    },

    delete(sessionId): Promise<void> {
      // Runs cascade via the foreign key.
      db.delete(sessions).where(eq(sessions.sessionId, sessionId)).run();
      return Promise.resolve();
    },
  };
}

function toSessionRow(record: SessionRecord): typeof sessions.$inferInsert {
  return {
    sessionId: record.sessionId,
    kind: record.kind,
    cwd: record.cwd,
    title: record.title ?? null,
    originType: record.origin.type,
    originHistoryId: record.origin.type === 'imported' ? record.origin.historyId : null,
    originImportedAt: record.origin.type === 'imported' ? record.origin.importedAt : null,
    createdVia: record.createdVia ?? null,
    automationKind: record.automation?.kind ?? null,
    automationId: record.automation?.id ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toRecord(row: SessionRow, runRows: RunRow[]): SessionRecord {
  return SessionRecordSchema.parse({
    sessionId: row.sessionId,
    kind: row.kind,
    cwd: row.cwd,
    title: row.title ?? undefined,
    origin:
      row.originType === 'imported'
        ? {
            type: 'imported',
            historyId: row.originHistoryId,
            importedAt: row.originImportedAt,
          }
        : { type: 'created' },
    createdVia: row.createdVia ?? undefined,
    automation:
      row.automationKind && row.automationId
        ? { kind: row.automationKind, id: row.automationId }
        : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    runs: runRows.map((run) => ({
      historyId: run.historyId ?? undefined,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? undefined,
    })),
  });
}
