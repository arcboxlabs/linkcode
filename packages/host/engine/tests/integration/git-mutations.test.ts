import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { GitService } from '../../src/git/git-service';
import { checkGitBranchSwitch, commitGitChanges, createGitBranch } from '../../src/git/mutations';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function makeRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'linkcode-git-mutations-'));
  roots.push(cwd);
  git(cwd, 'init', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@test');
  git(cwd, 'config', 'user.name', 'test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(cwd, 'file.txt'), 'one\n');
  git(cwd, 'add', '--all');
  git(cwd, 'commit', '-m', 'initial');
  return cwd;
}

afterEach(() => {
  const drained = roots.splice(0);
  for (let i = 0, len = drained.length; i < len; i++) {
    const root = drained[i];
    rmSync(root, { recursive: true, force: true });
  }
});

describe('git mutations', () => {
  it('reports ready for the current branch and conflicting file statistics for another branch', async () => {
    const cwd = makeRepo();
    await expect(Effect.runPromise(checkGitBranchSwitch(cwd, 'main'))).resolves.toEqual({
      status: 'ready',
    });
    git(cwd, 'checkout', '-b', 'target');
    writeFileSync(join(cwd, 'file.txt'), 'target\nline\n');
    git(cwd, 'commit', '-am', 'target');
    git(cwd, 'checkout', 'main');
    writeFileSync(join(cwd, 'file.txt'), 'local\n');

    await expect(Effect.runPromise(checkGitBranchSwitch(cwd, 'target'))).resolves.toEqual({
      status: 'conflict',
      files: [{ path: 'file.txt', additions: 1, deletions: 1 }],
    });
  });

  it('detects untracked files that the target branch would overwrite', async () => {
    const cwd = makeRepo();
    git(cwd, 'checkout', '-b', 'target');
    writeFileSync(join(cwd, 'target.txt'), 'target\n');
    git(cwd, 'add', '--all');
    git(cwd, 'commit', '-m', 'target file');
    git(cwd, 'checkout', 'main');
    writeFileSync(join(cwd, 'target.txt'), 'local\n');
    const nested = join(cwd, 'nested');
    mkdirSync(nested);

    await expect(Effect.runPromise(checkGitBranchSwitch(nested, 'target'))).resolves.toEqual({
      status: 'conflict',
      files: [{ path: 'target.txt', additions: null, deletions: null }],
    });
    await expect(Effect.runPromise(checkGitBranchSwitch(cwd, 'missing'))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('creates a branch without checking it out and rejects invalid or existing names', async () => {
    const cwd = makeRepo();
    await Effect.runPromise(createGitBranch(cwd, 'feature'));
    expect(git(cwd, 'branch', '--show-current')).toBe('main');
    expect(git(cwd, 'rev-parse', 'feature')).toBe(git(cwd, 'rev-parse', 'HEAD'));
    await expect(Effect.runPromise(createGitBranch(cwd, 'bad name'))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(Effect.runPromise(createGitBranch(cwd, 'feature'))).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('commits all tracked and untracked changes and leaves the worktree clean', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'file.txt'), 'changed\n');
    writeFileSync(join(cwd, 'new.txt'), 'new\n');
    const service = await Effect.runPromise(GitService.make([]));
    await expect(Effect.runPromise(service.getDiff(cwd, 'uncommitted'))).resolves.toMatchObject({
      stat: { files: 2 },
    });
    await Effect.runPromise(service.commitChanges(cwd, '  quick save  '));
    expect(git(cwd, 'status', '--porcelain')).toBe('');
    expect(git(cwd, 'show', '--format=%s', '--no-patch', 'HEAD')).toBe('quick save');
    await expect(Effect.runPromise(service.getDiff(cwd, 'uncommitted'))).resolves.toMatchObject({
      patch: '',
      stat: { files: 0 },
    });
  });

  it('rejects an empty commit message without staging changes', async () => {
    const cwd = makeRepo();
    writeFileSync(join(cwd, 'file.txt'), 'changed\n');

    await expect(Effect.runPromise(commitGitChanges(cwd, '   '))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('');
  });
});
