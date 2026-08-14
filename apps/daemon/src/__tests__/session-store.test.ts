import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordSchema } from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionStore } from '../session-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
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
      runs: [
        { startedAt: 1, endedAt: 2, historyId: 'native-1', accountId: 'acc_first' },
        {
          startedAt: 3,
          historyId: 'native-2',
          accountId: 'acc_second',
          model: 'model-second',
          effort: 'xhigh',
          approvalPolicyId: 'acceptEdits',
        },
      ],
    });
    await createSessionStore(database).save(record);

    expect(await createSessionStore(database).load()).toEqual([record]);
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
        { startedAt: 1, model: 'first' },
        { startedAt: 2, model: 'second' },
        { startedAt: 3, model: 'third' },
      ],
    });
    const store = createSessionStore(database);
    await store.save(record);
    // A later save rewrites the whole run list; the newest run is what a relaunch reads back.
    await store.save({ ...record, runs: [...record.runs, { startedAt: 4, model: 'fourth' }] });

    const [reloaded] = await createSessionStore(database).load();
    expect(reloaded.runs.map((run) => run.model)).toEqual(['first', 'second', 'third', 'fourth']);
  });
});
