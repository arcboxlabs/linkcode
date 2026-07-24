import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Logger as EffectLogger } from 'effect';
import { noop } from 'foxts/noop';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readGitBranches } from '../../src/git/branches';
import { GitService } from '../../src/git/git-service';
import { GitProviderError } from '../../src/git/provider';
import { readGitStatus } from '../../src/git/status';

const roots: string[] = [];
const silentLogger = EffectLogger.layer([EffectLogger.make(noop)]);
const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
const previousGitConfigNoSystem = process.env.GIT_CONFIG_NOSYSTEM;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-git-test-'));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  // The fixture repos must not inherit the machine's commit signing (a locked
  // signer would fail every `git commit` here).
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

function commitAt(cwd: string, branch: string, date: string): void {
  git(cwd, 'checkout', '-b', branch);
  execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.email=test@test',
      '-c',
      'user.name=test',
      'commit',
      '--allow-empty',
      '-m',
      branch,
    ],
    {
      cwd,
      stdio: 'ignore',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    },
  );
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

beforeAll(() => {
  const globalConfig = join(makeTempDir(), 'global.gitconfig');
  writeFileSync(globalConfig, '');
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
  if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal;
  if (previousGitConfigNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = previousGitConfigNoSystem;
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('readGitStatus', () => {
  it('reports a non-repo directory', async () => {
    const dir = makeTempDir();
    await expect(Effect.runPromise(readGitStatus(dir))).resolves.toEqual({ isRepo: false });
  });

  it('reads branch, cleanliness, and missing remote/upstream of a fresh repo', async () => {
    const dir = makeRepo();
    const status = await Effect.runPromise(readGitStatus(dir));
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
    const status = await Effect.runPromise(readGitStatus(dir));
    expect(status.isRepo && status.dirtyFileCount).toBe(2);
  });

  it('resolves the origin remote to a provider identity', async () => {
    const dir = makeRepo();
    git(dir, 'remote', 'add', 'origin', 'git@github.com:arcboxlabs/linkcode.git');
    const status = await Effect.runPromise(readGitStatus(dir));
    expect(status.isRepo && status.remote).toEqual({
      url: 'git@github.com:arcboxlabs/linkcode.git',
      identity: { provider: 'github', host: 'github.com', owner: 'arcboxlabs', repo: 'linkcode' },
    });
  });

  it('reports a detached HEAD as a null branch', async () => {
    const dir = makeRepo();
    git(dir, 'checkout', '--detach');
    const status = await Effect.runPromise(readGitStatus(dir));
    expect(status.isRepo && status.branch).toBeNull();
  });

  it('does not expose provider rejection details', async () => {
    const dir = makeRepo();
    git(dir, 'remote', 'add', 'origin', 'git@github.com:arcboxlabs/linkcode.git');
    const service = await Effect.runPromise(
      GitService.make([
        {
          kind: 'github',
          getPullRequestStatus: () =>
            Effect.fail(
              new GitProviderError({
                operation: 'command',
                cause: new Error('token ghp-secret was rejected'),
              }),
            ),
        },
      ]).pipe(Effect.provide(silentLogger)),
    );

    await expect(Effect.runPromise(service.getPullRequestStatus(dir))).resolves.toEqual({
      status: 'error',
      message: 'Provider request failed',
    });
  });

  it('retries a provider request after a failure', async () => {
    const dir = makeRepo();
    git(dir, 'remote', 'add', 'origin', 'git@github.com:arcboxlabs/linkcode.git');
    let firstRequest = true;
    const service = await Effect.runPromise(
      GitService.make([
        {
          kind: 'github',
          getPullRequestStatus() {
            if (firstRequest) {
              firstRequest = false;
              return Effect.fail(
                new GitProviderError({
                  operation: 'command',
                  cause: new Error('temporary provider failure'),
                }),
              );
            }
            return Effect.succeed({ status: 'ok', pullRequest: null } as const);
          },
        },
      ]).pipe(Effect.provide(silentLogger)),
    );

    await expect(Effect.runPromise(service.getPullRequestStatus(dir))).resolves.toEqual({
      status: 'error',
      message: 'Provider request failed',
    });
    await expect(Effect.runPromise(service.getPullRequestStatus(dir))).resolves.toEqual({
      status: 'ok',
      pullRequest: null,
    });
  });
});

describe('readGitBranches', () => {
  it('reports a non-repo directory', async () => {
    await expect(Effect.runPromise(readGitBranches(makeTempDir()))).resolves.toEqual({
      isRepo: false,
    });
  });

  it('lists local branches current-first, then by descending committer date', async () => {
    const dir = makeRepo();
    commitAt(dir, 'older', '2024-01-01T00:00:00Z');
    git(dir, 'checkout', 'main');
    commitAt(dir, 'newer', '2024-02-01T00:00:00Z');
    git(dir, 'checkout', 'main');
    git(dir, 'remote', 'add', 'origin', dir);
    git(dir, 'fetch', 'origin');

    const result = await Effect.runPromise(readGitBranches(dir));
    expect(result.isRepo).toBe(true);
    if (!result.isRepo) return;
    expect(result.branches[0]?.name).toBe('main');
    expect(result.branches[0]?.isCurrent).toBe(true);
    expect(result.branches[0]?.lastCommitAt).toEqual(expect.any(Number));
    expect(result.branches.slice(1)).toEqual([
      { name: 'newer', isCurrent: false, lastCommitAt: Date.parse('2024-02-01T00:00:00Z') },
      { name: 'older', isCurrent: false, lastCommitAt: Date.parse('2024-01-01T00:00:00Z') },
    ]);
  });
});
