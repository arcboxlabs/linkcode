import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordSchema, SessionRunSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { DaemonDatabase } from '../db/database';
import { openDaemonDatabase } from '../db/database';
import { createSessionStore } from '../session-store';

const temporaryDirectories: string[] = [];
const openDatabases = new Set<DaemonDatabase>();

function openDatabase(path: string): DaemonDatabase {
  const database = openDaemonDatabase(path);
  openDatabases.add(database);
  return database;
}

function closeDatabase(database: DaemonDatabase): void {
  database.close();
  openDatabases.delete(database);
}

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'linkcode-session-store-'));
  temporaryDirectories.push(directory);
  return join(directory, 'daemon.db');
}

describe('SQLite session store', () => {
  /**
   * The engine reads a thread's own picks back off its runs to relaunch it, so a field this table
   * drops is a thread silently returning to the agent's configured default on the next daemon boot.
   * The in-memory store round-trips whole objects and cannot catch that; only this can.
   */
  it('round-trips every field of a run, not just the ones the engine happens to set', async () => {
    const database = await databasePath();
    const record = SessionRecordSchema.parse({
      sessionId: 'session-pinned',
      kind: 'claude-code',
      cwd: '/repo',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 2,
      activeLeafTurnId: 'turn-leaf',
      graphRevision: 7,
      runs: [
        { runId: 'run-1', startedAt: 1, endedAt: 2, historyId: 'native-1', accountId: 'acc_first' },
        {
          runId: 'run-2',
          baseTurnId: 'turn-base',
          startedAt: 3,
          historyId: 'native-2',
          accountId: 'acc_second',
          model: 'model-second',
          effort: 'xhigh',
          approvalPolicyId: 'acceptEdits',
        },
      ],
    });
    const first = openDatabase(database);
    await createSessionStore(first.client).save(record);
    closeDatabase(first);

    expect(await createSessionStore(openDatabase(database).client).load()).toEqual([record]);
  });

  it('round-trips additive fork provenance and upgrades an existing forked origin row', async () => {
    const database = await databasePath();
    const record = SessionRecordSchema.parse({
      sessionId: 'session-forked',
      kind: 'codex',
      cwd: '/repo',
      origin: { type: 'created' },
      forkOrigin: {
        sourceSessionId: 'session-source',
        sourceTurnId: 'turn-cut',
        forkedAt: 5,
      },
      createdAt: 5,
      updatedAt: 6,
      runs: [],
    });
    const first = openDatabase(database);
    await createSessionStore(first.client).save(record);
    closeDatabase(first);

    const second = openDatabase(database);
    expect(await createSessionStore(second.client).load()).toEqual([record]);

    closeDatabase(second);
    const sqlite = new Sqlite(database);
    expect(sqlite.prepare('SELECT origin_type FROM sessions').pluck().get()).toBe('created');
    sqlite
      .prepare("UPDATE sessions SET origin_type = 'forked' WHERE session_id = ?")
      .run(record.sessionId);
    sqlite.close();
    expect(await createSessionStore(openDatabase(database).client).load()).toEqual([record]);
  });

  it('keeps run order across a reload, since the array position is part of the record', async () => {
    const database = await databasePath();
    const record = SessionRecordSchema.parse({
      sessionId: 'session-ordered',
      kind: 'codex',
      cwd: '/repo',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 1,
      runs: [
        { runId: 'run-1', startedAt: 1, model: 'first' },
        { runId: 'run-2', startedAt: 2, model: 'second' },
        { runId: 'run-3', startedAt: 3, model: 'third' },
      ],
    });
    const first = openDatabase(database);
    const store = createSessionStore(first.client);
    await store.save(record);
    // A later save rewrites the whole run list; the newest run is what a relaunch reads back.
    await store.save({
      ...record,
      runs: [
        ...record.runs,
        SessionRunSchema.parse({ runId: 'run-4', startedAt: 4, model: 'fourth' }),
      ],
    });

    closeDatabase(first);
    const [reloaded] = await createSessionStore(openDatabase(database).client).load();
    expect(reloaded.runs.map((run) => run.model)).toEqual(['first', 'second', 'third', 'fourth']);
  });

  it('refuses to save a run without a runId instead of minting a drifting one', async () => {
    const database = await databasePath();
    // runId is optional at the wire parse boundary only; every engine writer mints it.
    const record = SessionRecordSchema.parse({
      sessionId: 'session-runless',
      kind: 'claude-code',
      cwd: '/repo',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 1,
      runs: [{ startedAt: 1 }],
    });

    const store = createSessionStore(openDatabase(database).client);
    await expect(async () => store.save(record)).rejects.toThrow('without runId');
  });
});
