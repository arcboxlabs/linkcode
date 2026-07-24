import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionIdSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { GitService } from '../../src/git/git-service';
import { WorktreeService } from '../../src/worktree/worktree-service';
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
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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
});
