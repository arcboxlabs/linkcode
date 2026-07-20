import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionRecord } from '@linkcode/schema';
import { SessionRecordSchema } from '@linkcode/schema';
import Sqlite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionStore } from '../../src/session-store';

function makeRecord(value: Record<string, unknown>): SessionRecord {
  return SessionRecordSchema.parse({
    sessionId: 'sess-1',
    kind: 'claude-code',
    cwd: '/repo',
    origin: { type: 'created' },
    createdAt: 1,
    updatedAt: 2,
    runs: [],
    ...value,
  });
}

describe('daemon sqlite session store', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    while (tmpDirs.length > 0) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  it('round-trips created and imported records', async () => {
    const store = createSessionStore(':memory:');
    const created = makeRecord({
      runs: [{ startedAt: 1 }, { historyId: 'native-1', startedAt: 5, endedAt: 9 }],
    });
    const imported = makeRecord({
      sessionId: 'sess-2',
      kind: 'codex',
      cwd: '/other',
      title: 'Imported session',
      origin: { type: 'imported', historyId: 'native-9', importedAt: 3 },
    });
    await store.save(created);
    await store.save(imported);

    const loaded = (await store.load()).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(loaded).toEqual([created, imported]);
  });

  it('saves as a whole-record upsert, rewriting runs', async () => {
    const store = createSessionStore(':memory:');
    await store.save(makeRecord({ runs: [{ startedAt: 1 }] }));
    const next = makeRecord({
      title: 'Renamed',
      updatedAt: 20,
      runs: [
        { historyId: 'native-1', startedAt: 1, endedAt: 10 },
        { historyId: 'native-2', startedAt: 15 },
      ],
    });
    await store.save(next);

    const loaded = await store.load();
    expect(loaded).toEqual([next]);
  });

  it('reboots without re-running an already-applied migration whose journal timestamp drifted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'linkcode-session-store-'));
    tmpDirs.push(dir);
    const dbPath = join(dir, 'daemon.db');

    const first = createSessionStore(dbPath);
    const record = makeRecord({ runs: [{ startedAt: 1 }] });
    await first.save(record);

    // Simulate a dev DB migrated under an older journal: the newest migration's created_at predates
    // the journal's `when`, which without reconciliation re-runs it and crashes on the duplicate column.
    const raw = new Sqlite(dbPath);
    raw
      .prepare(
        'UPDATE __drizzle_migrations SET created_at = created_at - 1000 ' +
          'WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)',
      )
      .run();
    raw.close();

    const second = createSessionStore(dbPath);
    expect(await second.load()).toEqual([record]);
  });

  it('deletes a record together with its runs', async () => {
    const store = createSessionStore(':memory:');
    const record = makeRecord({ runs: [{ startedAt: 1 }] });
    await store.save(record);
    await store.delete(record.sessionId);
    expect(await store.load()).toEqual([]);

    // The cascade left no orphans behind that would block reusing the id.
    await store.save(record);
    expect(await store.load()).toEqual([record]);
  });
});
