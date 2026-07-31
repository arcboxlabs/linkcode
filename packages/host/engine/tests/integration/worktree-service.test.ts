import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionIdSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { GitService } from '../../src/git/git-service';
import { WorktreeService } from '../../src/worktree/worktree-service';
import type { WorktreeStore } from '../../src/worktree/worktree-store';
import { InMemoryWorktreeStore } from '../../src/worktree/worktree-store';

const roots: string[] = [];

function temp(): string {
  const path = mkdtempSync(join(tmpdir(), 'linkcode-worktree-test-'));
  roots.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

function repo(): string {
  const path = temp();
  const remote = temp();
  git(remote, 'init', '--bare');
  git(path, 'init', '-b', 'main');
  git(
    path,
    '-c',
    'user.email=test@test',
    '-c',
    'user.name=test',
    'commit',
    '--allow-empty',
    '-m',
    'init',
  );
  git(path, 'branch', 'feature/a');
  git(path, 'remote', 'add', 'origin', remote);
  git(path, 'push', '--all', '--set-upstream', 'origin');
  return path;
}

async function managedWorktree(store: WorktreeStore = new InMemoryWorktreeStore()) {
  const cwd = repo();
  const root = temp();
  const service = new WorktreeService(store, root, await Effect.runPromise(GitService.make([])));
  await Effect.runPromise(service.start());
  const id = SessionIdSchema.parse('sess-cleanup');
  const worktree = await Effect.runPromise(
    service.provision({ kind: 'pi', cwd, branch: { name: 'feature/a' } }, id),
  );
  return { cwd, root, service, id, worktree };
}

afterEach(() => {
  const removedRoots = roots.splice(0);
  for (let i = 0, len = removedRoots.length; i < len; i++) {
    rmSync(removedRoots[i], { recursive: true, force: true });
  }
});

describe('WorktreeService', () => {
  it('keeps the original cwd and no row for the current branch', async () => {
    const cwd = repo();
    const store = new InMemoryWorktreeStore();
    const service = new WorktreeService(
      store,
      temp(),
      await Effect.runPromise(GitService.make([])),
    );
    await Effect.runPromise(service.start());

    const result = await Effect.runPromise(
      service.provision(
        { kind: 'pi', cwd, branch: { name: 'main' } },
        SessionIdSchema.parse('sess-current'),
      ),
    );
    expect(result).toEqual({ kind: 'pi', cwd });
    expect(await store.load()).toEqual([]);
  });

  it('creates and persists a non-current local branch and rejects a duplicate', async () => {
    const cwd = repo();
    const store = new InMemoryWorktreeStore();
    const gitService = await Effect.runPromise(GitService.make([]));
    const service = new WorktreeService(store, temp(), gitService);
    await Effect.runPromise(service.start());
    await Effect.runPromise(gitService.listBranches(cwd));

    const result = await Effect.runPromise(
      service.provision(
        { kind: 'pi', cwd, branch: { name: 'feature/a' } },
        SessionIdSchema.parse('sess-feature'),
      ),
    );
    expect(result.branch).toBeUndefined();
    expect(result.cwd).not.toBe(cwd);
    expect(existsSync(result.cwd)).toBe(true);
    expect((await store.load())[0]).toMatchObject({
      worktreePath: result.cwd,
      repoRoot: cwd,
      branch: 'feature/a',
      state: 'active',
    });
    const status = await Effect.runPromise(gitService.getStatus(result.cwd));
    expect(status.isRepo && status.branch).toBe('feature/a');

    const failure = await Effect.runPromiseExit(
      service.provision(
        { kind: 'pi', cwd, branch: { name: 'feature/a' } },
        SessionIdSchema.parse('sess-duplicate'),
      ),
    );
    expect(failure._tag).toBe('Failure');
  });

  it('rejects a missing branch and reports a vanished managed worktree on resume', async () => {
    const cwd = repo();
    const service = new WorktreeService(
      new InMemoryWorktreeStore(),
      temp(),
      await Effect.runPromise(GitService.make([])),
    );
    await Effect.runPromise(service.start());
    const missing = await Effect.runPromiseExit(
      service.provision(
        { kind: 'pi', cwd, branch: { name: 'missing' } },
        SessionIdSchema.parse('sess-missing-branch'),
      ),
    );
    expect(missing._tag).toBe('Failure');

    const id = SessionIdSchema.parse('sess-vanished');
    const result = await Effect.runPromise(
      service.provision({ kind: 'pi', cwd, branch: { name: 'feature/a' } }, id),
    );
    rmSync(result.cwd, { recursive: true, force: true });
    await expect(Effect.runPromise(service.verifyResume(id))).rejects.toMatchObject({
      code: 'worktree_missing',
    });
  });

  it('serializes concurrent starts for the same repository branch', async () => {
    const cwd = repo();
    const service = new WorktreeService(
      new InMemoryWorktreeStore(),
      temp(),
      await Effect.runPromise(GitService.make([])),
    );
    await Effect.runPromise(service.start());

    const starts = await Promise.allSettled([
      Effect.runPromise(
        service.provision(
          { kind: 'pi', cwd, branch: { name: 'feature/a' } },
          SessionIdSchema.parse('sess-concurrent-a'),
        ),
      ),
      Effect.runPromise(
        service.provision(
          { kind: 'pi', cwd, branch: { name: 'feature/a' } },
          SessionIdSchema.parse('sess-concurrent-b'),
        ),
      ),
    ]);
    expect(starts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(starts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  });

  it('removes only a clean, tracked worktree with no unpushed commits', async () => {
    const store = new InMemoryWorktreeStore();
    const { service, id, worktree } = await managedWorktree(store);

    await Effect.runPromise(service.cleanupDeletedSession(id));

    expect(existsSync(worktree.cwd)).toBe(false);
    expect(await store.load()).toEqual([]);
  });

  it.each([
    ['dirty', (path: string) => writeFileSync(join(path, 'untracked'), 'dirty')],
    ['without an upstream', (path: string) => git(path, 'branch', '--unset-upstream')],
    [
      'ahead of its upstream',
      (path: string) =>
        git(
          path,
          '-c',
          'user.email=test@test',
          '-c',
          'user.name=test',
          'commit',
          '--allow-empty',
          '-m',
          'unpushed',
        ),
    ],
  ])('orphans and preserves a deleted-session worktree that is %s', async (_name, makeUnsafe) => {
    const store = new InMemoryWorktreeStore();
    const { service, id, worktree } = await managedWorktree(store);
    makeUnsafe(worktree.cwd);

    await Effect.runPromise(service.cleanupDeletedSession(id));

    expect(existsSync(worktree.cwd)).toBe(true);
    expect(await store.load()).toMatchObject([{ state: 'orphaned' }]);
  });

  it('does not update the in-memory ownership state when orphan persistence fails', async () => {
    const inner = new InMemoryWorktreeStore();
    let rejectSaves = false;
    const store: WorktreeStore = {
      load: () => inner.load(),
      save: (record) =>
        rejectSaves ? Promise.reject(new Error('disk unavailable')) : inner.save(record),
      delete: (path) => inner.delete(path),
    };
    const { service, id, worktree } = await managedWorktree(store);
    writeFileSync(join(worktree.cwd, 'untracked'), 'dirty');
    rejectSaves = true;

    const result = await Effect.runPromiseExit(service.cleanupDeletedSession(id));

    expect(result._tag).toBe('Failure');
    expect(service.get(id)?.state).toBe('active');
    expect(await inner.load()).toMatchObject([{ state: 'active' }]);
    expect(existsSync(worktree.cwd)).toBe(true);
  });

  it('keeps active ownership when non-force removal fails', async () => {
    const store = new InMemoryWorktreeStore();
    const { root, id, worktree } = await managedWorktree(store);
    const [record] = await store.load();
    await store.save({ ...record, repoRoot: join(temp(), 'missing') });
    const restarted = new WorktreeService(
      store,
      root,
      await Effect.runPromise(GitService.make([])),
    );
    await Effect.runPromise(restarted.start(new Set([id])));

    const result = await Effect.runPromiseExit(restarted.cleanupDeletedSession(id));

    expect(result._tag).toBe('Failure');
    expect(existsSync(worktree.cwd)).toBe(true);
    expect(await store.load()).toMatchObject([{ state: 'active' }]);
  });

  it('reconciles active rows without sessions and missing rows on boot', async () => {
    const safeStore = new InMemoryWorktreeStore();
    const safe = await managedWorktree(safeStore);
    const safeRestart = new WorktreeService(
      safeStore,
      safe.root,
      await Effect.runPromise(GitService.make([])),
    );
    await Effect.runPromise(safeRestart.start());
    expect(existsSync(safe.worktree.cwd)).toBe(false);
    expect(await safeStore.load()).toEqual([]);

    const missingStore = new InMemoryWorktreeStore();
    const missing = await managedWorktree(missingStore);
    rmSync(missing.worktree.cwd, { recursive: true, force: true });
    const missingRestart = new WorktreeService(
      missingStore,
      missing.root,
      await Effect.runPromise(GitService.make([])),
    );
    await Effect.runPromise(missingRestart.start());
    expect(await missingStore.load()).toEqual([]);
  });

  it('retains a missing ownership row when its durable session still exists', async () => {
    const store = new InMemoryWorktreeStore();
    const { root, id, worktree } = await managedWorktree(store);
    rmSync(worktree.cwd, { recursive: true, force: true });
    const restarted = new WorktreeService(
      store,
      root,
      await Effect.runPromise(GitService.make([])),
    );

    await Effect.runPromise(restarted.start(new Set([id])));

    expect(await store.load()).toMatchObject([{ state: 'orphaned' }]);
    await expect(Effect.runPromise(restarted.verifyResume(id))).rejects.toMatchObject({
      code: 'worktree_missing',
    });
  });

  it('records unknown linked worktrees as orphaned but ignores ordinary directories', async () => {
    const cwd = repo();
    const root = temp();
    const candidate = join(root, 'repo-group', 'feature-leaf');
    mkdirSync(join(root, 'repo-group'));
    git(cwd, 'worktree', 'add', '--', candidate, 'feature/a');

    const standalone = join(root, 'standalone-group', 'repo');
    mkdirSync(standalone, { recursive: true });
    git(standalone, 'init', '-b', 'main');
    const malformed = join(root, 'malformed-group', 'leaf');
    mkdirSync(malformed, { recursive: true });
    writeFileSync(join(malformed, '.git'), 'not git metadata');

    const store = new InMemoryWorktreeStore();
    const service = new WorktreeService(store, root, await Effect.runPromise(GitService.make([])));
    await Effect.runPromise(service.start());
    await Effect.runPromise(service.start());

    expect(existsSync(candidate)).toBe(true);
    expect(await store.load()).toMatchObject([
      {
        worktreePath: candidate,
        repoRoot: cwd,
        branch: 'feature/a',
        state: 'orphaned',
      },
    ]);
  });
});
