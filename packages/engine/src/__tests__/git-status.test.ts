import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readGitStatus } from '../git/status';

const roots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-git-test-'));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(): string {
  const dir = makeTempDir();
  git(dir, 'init', '-b', 'main');
  git(
    dir,
    '-c',
    'user.email=test@test',
    '-c',
    'user.name=test',
    'commit',
    '--allow-empty',
    '-m',
    'init',
  );
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('readGitStatus', () => {
  it('reports a non-repo directory', async () => {
    const dir = makeTempDir();
    await expect(readGitStatus(dir)).resolves.toEqual({ isRepo: false });
  });

  it('reads branch, cleanliness, and missing remote/upstream of a fresh repo', async () => {
    const dir = makeRepo();
    const status = await readGitStatus(dir);
    expect(status).toEqual({
      isRepo: true,
      repoRoot: expect.any(String) as string,
      branch: 'main',
      dirtyFileCount: 0,
      ahead: null,
      behind: null,
      remote: null,
    });
  });

  it('counts dirty files including untracked ones', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'a.txt'), 'a');
    writeFileSync(join(dir, 'b.txt'), 'b');
    const status = await readGitStatus(dir);
    expect(status.isRepo && status.dirtyFileCount).toBe(2);
  });

  it('resolves the origin remote to a provider identity', async () => {
    const dir = makeRepo();
    git(dir, 'remote', 'add', 'origin', 'git@github.com:arcboxlabs/linkcode.git');
    const status = await readGitStatus(dir);
    expect(status.isRepo && status.remote).toEqual({
      url: 'git@github.com:arcboxlabs/linkcode.git',
      identity: { provider: 'github', host: 'github.com', owner: 'arcboxlabs', repo: 'linkcode' },
    });
  });

  it('reports a detached HEAD as a null branch', async () => {
    const dir = makeRepo();
    git(dir, 'checkout', '--detach');
    const status = await readGitStatus(dir);
    expect(status.isRepo && status.branch).toBeNull();
  });
});
