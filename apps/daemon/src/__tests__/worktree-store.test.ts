import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeUnavailableError } from '@linkcode/engine';
import type { SessionId, WorktreeRecord } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { daemonMigrationsFolder } from '../database-migrations';
import type { DaemonDatabase } from '../db/database';
import { openDaemonDatabase } from '../db/database';
import { createWorktreeStore } from '../worktree-store';

const temporaryDirectories: string[] = [];
const openDatabases = new Set<DaemonDatabase>();

const s1 = 's-1' as SessionId;
const s2 = 's-2' as SessionId;
const s3 = 's-3' as SessionId;

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'linkcode-worktree-store-'));
  temporaryDirectories.push(directory);
  return join(directory, 'daemon.db');
}

async function openStore() {
  const database = openDaemonDatabase(await databasePath());
  openDatabases.add(database);
  return { database, store: createWorktreeStore(database.client) };
}

function record(worktreePath: string, branch = 'feature'): WorktreeRecord {
  return { worktreePath, repoRoot: '/repo', branch, createdAt: 1, state: 'active' };
}

/** Migrate a fresh file up to (excluding) the lease migration, the way drizzle's migrator would
 * have left a daemon that shut down before it shipped. */
function openPreLeaseDatabase(path: string): Sqlite.Database {
  const sqlite = new Sqlite(path);
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
  );
  const applied = sqlite.prepare(
    'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
  );
  const migrations = readMigrationFiles({ migrationsFolder: daemonMigrationsFolder });
  for (let i = 0, len = migrations.length; i < len; i++) {
    const migration = migrations[i];
    if (migration.sql.some((statement) => statement.includes('worktree_sessions'))) break;
    for (let j = 0, statements = migration.sql.length; j < statements; j++) {
      sqlite.exec(migration.sql[j]);
    }
    applied.run(migration.hash, migration.folderMillis);
  }
  return sqlite;
}

describe('SQLite worktree store', () => {
  it('round-trips records and updates them by worktree path', async () => {
    const { store } = await openStore();
    const active = record('/wt/a');
    const orphan: WorktreeRecord = { ...record('/wt/old', 'old'), state: 'orphaned' };
    await store.save(active);
    await store.save(orphan);
    expect((await store.load()).worktrees).toEqual([active, orphan]);
    await store.save({ ...active, state: 'orphaned' });
    expect((await store.load()).worktrees).toEqual([{ ...active, state: 'orphaned' }, orphan]);
  });

  it('marks the worktree deleting with its last release and refuses new leases from then on', async () => {
    const { store } = await openStore();
    await store.save(record('/wt/a'));
    await store.acquireLease('/wt/a', s1);
    await store.acquireLease('/wt/a', s1);
    await store.acquireLease('/wt/a', s2);
    expect((await store.load()).leases.map((lease) => lease.sessionId)).toEqual([s1, s2]);

    expect(await store.releaseLease(s1)).toEqual({ worktreePath: '/wt/a', last: false });
    expect((await store.load()).worktrees).toEqual([record('/wt/a')]);
    expect(await store.releaseLease(s1)).toBeUndefined();

    expect(await store.releaseLease(s2)).toEqual({ worktreePath: '/wt/a', last: true });
    expect((await store.load()).worktrees).toMatchObject([{ state: 'deleting' }]);
    await expect(store.acquireLease('/wt/a', s3)).rejects.toBeInstanceOf(WorktreeUnavailableError);
  });

  it('refuses a lease on an unknown worktree or a second worktree for one session', async () => {
    const { store } = await openStore();
    await expect(store.acquireLease('/wt/missing', s1)).rejects.toBeInstanceOf(
      WorktreeUnavailableError,
    );
    await store.save(record('/wt/a'));
    await store.save(record('/wt/b', 'other'));
    await store.acquireLease('/wt/a', s1);
    await expect(store.acquireLease('/wt/b', s1)).rejects.toThrow('Failed to lease worktree');
    expect((await store.load()).leases).toMatchObject([{ worktreePath: '/wt/a', sessionId: s1 }]);
  });

  it('keeps one worktree per repository branch and drops the leases with the worktree', async () => {
    const { store } = await openStore();
    await store.save(record('/wt/a'));
    await expect(store.save(record('/wt/b'))).rejects.toThrow('Failed to save worktree');
    await store.acquireLease('/wt/a', s1);
    await store.delete('/wt/a');
    expect(await store.load()).toEqual({ worktrees: [], leases: [] });
  });

  it('backfills leases from the owning-session column when migrating a pre-lease database', async () => {
    const path = await databasePath();
    const legacy = openPreLeaseDatabase(path);
    legacy
      .prepare(
        'INSERT INTO worktrees (worktree_path, repo_root, branch, session_id, created_at, state) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('/wt/held', '/repo', 'feature', 's-legacy', 5, 'active');
    legacy
      .prepare(
        'INSERT INTO worktrees (worktree_path, repo_root, branch, session_id, created_at, state) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('/wt/orphan', '/repo', 'stale', 'orphan-worktree-0123456789ab', 6, 'orphaned');
    legacy.close();

    const database = openDaemonDatabase(path);
    openDatabases.add(database);
    expect(await createWorktreeStore(database.client).load()).toEqual({
      worktrees: [
        {
          worktreePath: '/wt/held',
          repoRoot: '/repo',
          branch: 'feature',
          createdAt: 5,
          state: 'active',
        },
        {
          worktreePath: '/wt/orphan',
          repoRoot: '/repo',
          branch: 'stale',
          createdAt: 6,
          state: 'orphaned',
        },
      ],
      leases: [{ worktreePath: '/wt/held', sessionId: 's-legacy', createdAt: 5 }],
    });

    // The physical schema, not just the projection: the column and its index are gone, so a
    // migration that forgot either DROP would be caught here rather than passing through load().
    const raw = new Sqlite(path);
    const columns = (raw.prepare('PRAGMA table_info(worktrees)').all() as Array<{ name: string }>)
      .map((column) => column.name)
      .sort();
    expect(columns).toEqual(['branch', 'created_at', 'repo_root', 'state', 'worktree_path']);
    const indexes = (
      raw.prepare('PRAGMA index_list(worktrees)').all() as Array<{ name: string }>
    ).map((index) => index.name);
    expect(indexes).not.toContain('worktrees_session_id_unique');
    raw.close();
  });
});
