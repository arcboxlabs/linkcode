import type { SessionId, WorktreeRecord } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { InMemoryWorktreeStore, WorktreeUnavailableError } from '../worktree/worktree-store';

const s1 = 's-1' as SessionId;
const s2 = 's-2' as SessionId;
const s3 = 's-3' as SessionId;

function record(worktreePath: string, branch = 'feature'): WorktreeRecord {
  return { worktreePath, repoRoot: '/repo', branch, createdAt: 1, state: 'active' };
}

describe('InMemoryWorktreeStore leases', () => {
  it('keeps one worktree per repository branch', async () => {
    const store = new InMemoryWorktreeStore();
    await store.save(record('/wt/a'));
    await expect(store.save(record('/wt/b'))).rejects.toThrow('worktree already exists');
    await store.save({ ...record('/wt/a'), state: 'orphaned' });
    expect((await store.load()).worktrees).toMatchObject([{ state: 'orphaned' }]);
  });

  it('marks the worktree deleting with its last release and refuses new leases from then on', async () => {
    const store = new InMemoryWorktreeStore();
    await store.save(record('/wt/a'));
    await store.acquireLease('/wt/a', s1);
    await store.acquireLease('/wt/a', s1);
    await store.acquireLease('/wt/a', s2);
    expect((await store.load()).leases.map((lease) => lease.sessionId)).toEqual([s1, s2]);

    expect(await store.releaseLease(s1)).toEqual({ worktreePath: '/wt/a', last: false });
    expect((await store.load()).worktrees).toMatchObject([{ state: 'active' }]);
    expect(await store.releaseLease(s1)).toBeUndefined();

    expect(await store.releaseLease(s2)).toEqual({ worktreePath: '/wt/a', last: true });
    expect((await store.load()).worktrees).toMatchObject([{ state: 'deleting' }]);
    await expect(store.acquireLease('/wt/a', s3)).rejects.toBeInstanceOf(WorktreeUnavailableError);
  });

  it('refuses a lease on an unknown worktree or a second worktree for one session', async () => {
    const store = new InMemoryWorktreeStore();
    await expect(store.acquireLease('/wt/missing', s1)).rejects.toBeInstanceOf(
      WorktreeUnavailableError,
    );
    await store.save(record('/wt/a'));
    await store.save(record('/wt/b', 'other'));
    await store.acquireLease('/wt/a', s1);
    await expect(store.acquireLease('/wt/b', s1)).rejects.toThrow('already holds a worktree');
  });

  it('drops the leases with the worktree', async () => {
    const store = new InMemoryWorktreeStore();
    await store.save(record('/wt/a'));
    await store.acquireLease('/wt/a', s1);
    await store.delete('/wt/a');
    expect(await store.load()).toEqual({ worktrees: [], leases: [] });
    expect(await store.releaseLease(s1)).toBeUndefined();
  });
});
