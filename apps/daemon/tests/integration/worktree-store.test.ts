import type { WorktreeRecord } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createWorktreeStore } from '../../src/worktree-store';

function record(values: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    worktreePath: '/managed/repo-feature',
    repoRoot: '/repo',
    branch: 'feature',
    sessionId: SessionIdSchema.parse('sess-1'),
    createdAt: 123,
    state: 'active',
    ...values,
  };
}

describe('daemon sqlite worktree store', () => {
  it('round-trips active and orphaned rows without requiring a session row', async () => {
    const store = createWorktreeStore(':memory:');
    const rows = [
      record(),
      record({
        worktreePath: '/managed/repo-old',
        branch: 'old',
        sessionId: SessionIdSchema.parse('sess-missing'),
        state: 'orphaned',
      }),
    ];
    await Promise.all(rows.map((row) => store.save(row)));
    expect(await store.load()).toEqual(rows);
  });

  it('enforces one row per normalized repository and branch', async () => {
    const store = createWorktreeStore(':memory:');
    await store.save(record());
    await expect(
      store.save(
        record({
          worktreePath: '/managed/duplicate',
          sessionId: SessionIdSchema.parse('sess-2'),
        }),
      ),
    ).rejects.toThrow();
  });

  it('updates and deletes a record by its worktree path', async () => {
    const store = createWorktreeStore(':memory:');
    const active = record();
    await store.save(active);
    await store.save({ ...active, state: 'orphaned' });
    expect(await store.load()).toEqual([{ ...active, state: 'orphaned' }]);

    await store.delete(active.worktreePath);
    expect(await store.load()).toEqual([]);
  });
});
