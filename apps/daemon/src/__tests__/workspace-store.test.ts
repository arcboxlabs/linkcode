import type { WorkspaceRecord } from '@linkcode/schema';
import { WorkspaceRecordSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../workspace-store';

function makeRecord(value: Record<string, unknown>): WorkspaceRecord {
  return WorkspaceRecordSchema.parse({
    workspaceId: 'ws-1',
    cwd: '/repo',
    createdAt: 1,
    lastUsedAt: 2,
    ...value,
  });
}

describe('daemon sqlite workspace store', () => {
  it('round-trips records, including an optional name', async () => {
    const store = createWorkspaceStore(':memory:');
    const named = makeRecord({ name: 'My Repo' });
    const unnamed = makeRecord({ workspaceId: 'ws-2', cwd: '/other' });
    await store.save(named);
    await store.save(unnamed);

    const loaded = (await store.load()).sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
    expect(loaded).toEqual([named, unnamed]);
  });

  it('saves as a whole-record upsert', async () => {
    const store = createWorkspaceStore(':memory:');
    await store.save(makeRecord({}));
    const renamed = makeRecord({ name: 'Renamed', lastUsedAt: 20 });
    await store.save(renamed);

    expect(await store.load()).toEqual([renamed]);
  });

  it('deletes a record', async () => {
    const store = createWorkspaceStore(':memory:');
    const record = makeRecord({});
    await store.save(record);
    await store.delete(record.workspaceId);
    expect(await store.load()).toEqual([]);
  });
});
