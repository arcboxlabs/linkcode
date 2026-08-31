import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Sqlite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { daemonMigrationsFolder } from '../database-migrations';

export type DaemonDatabaseClient = ReturnType<typeof drizzle>;

export interface DaemonDatabase {
  readonly client: DaemonDatabaseClient;
  readonly close: () => void;
}

/** Drizzle keys applied migrations by journal time, so realign known hashes before migrating. */
function reconcileMigrationLedger(sqlite: Sqlite.Database, migrationsFolder: string): void {
  const hasLedger = sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!hasLedger) return;
  const realign = sqlite.prepare(
    'UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ? AND created_at <> ?',
  );
  sqlite.transaction(() => {
    const migrations = readMigrationFiles({ migrationsFolder });
    for (let i = 0, len = migrations.length; i < len; i++) {
      const migration = migrations[i];
      realign.run(migration.folderMillis, migration.hash, migration.folderMillis);
    }
  })();
}

export function openDaemonDatabase(dbPath: string): DaemonDatabase {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Sqlite(dbPath);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    const client = drizzle(sqlite);
    reconcileMigrationLedger(sqlite, daemonMigrationsFolder);
    migrate(client, { migrationsFolder: daemonMigrationsFolder });
    return { client, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
