import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createFixedArray } from 'foxts/create-fixed-array';
import { afterAll, describe, expect, it } from 'vitest';
import { readGitDiff } from '../git/diff';

const roots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-git-diff-test-'));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  // The fixture repos must not inherit the machine's commit signing (a locked
  // signer would fail every `git commit` here).
  return execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
}

function commit(cwd: string, message: string, ...extraArgs: string[]): void {
  git(
    cwd,
    '-c',
    'user.email=test@test',
    '-c',
    'user.name=test',
    'commit',
    '-m',
    message,
    ...extraArgs,
  );
}

function makeRepo(): string {
  const dir = makeTempDir();
  git(dir, 'init', '-b', 'main');
  return dir;
}

/** A file large enough on its own to push a small collection of them past the patch byte cap,
 * while staying comfortably under it individually so truncation always lands on a file boundary. */
function bigLineBlock(byteSize: number, seed: string): string {
  const lineLength = 50;
  const lineCount = Math.ceil(byteSize / (lineLength + 1));
  const line = seed.padEnd(lineLength, '.');
  return `${createFixedArray(lineCount)
    .map((i) => `${line}${i}`)
    .join('\n')}\n`;
}

const SHORTSTAT_FILES = /(\d+) files? changed/;
const SHORTSTAT_ADDITIONS = /(\d+) insertions?\(\+\)/;
const SHORTSTAT_DELETIONS = /(\d+) deletions?\(-\)/;

function parseShortstat(output: string): { files: number; additions: number; deletions: number } {
  const files = SHORTSTAT_FILES.exec(output);
  const additions = SHORTSTAT_ADDITIONS.exec(output);
  const deletions = SHORTSTAT_DELETIONS.exec(output);
  return {
    files: files ? Number(files[1]) : 0,
    additions: additions ? Number(additions[1]) : 0,
    deletions: deletions ? Number(deletions[1]) : 0,
  };
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('readGitDiff', () => {
  it('diffs a tracked modification against HEAD', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    git(dir, 'add', 'a.txt');
    commit(dir, 'init');
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\n');

    const diff = await Effect.runPromise(readGitDiff(dir, 'uncommitted'));
    expect(diff.truncated).toBe(false);
    expect(diff.patch).toContain('diff --git a/a.txt b/a.txt');

    const expected = parseShortstat(git(dir, 'diff', '--shortstat', 'HEAD'));
    expect(diff.stat).toEqual(expected);
  });

  it('folds a new untracked file into the uncommitted diff', async () => {
    const dir = makeRepo();
    commit(dir, 'init', '--allow-empty');
    writeFileSync(join(dir, 'new.txt'), 'hello\nworld\n');

    const diff = await Effect.runPromise(readGitDiff(dir, 'uncommitted'));
    expect(diff.patch).toContain('diff --git a/new.txt b/new.txt');
    expect(diff.stat).toEqual({ files: 1, additions: 2, deletions: 0 });
  });

  it('keeps a binary untracked file to a marker line, never its raw bytes', async () => {
    const dir = makeRepo();
    commit(dir, 'init', '--allow-empty');
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 254]));

    const diff = await Effect.runPromise(readGitDiff(dir, 'uncommitted'));
    expect(diff.patch).toContain('Binary files /dev/null and b/binary.bin differ');
    expect(diff.patch.length).toBeLessThan(200);
    expect(diff.stat).toEqual({ files: 1, additions: 0, deletions: 0 });
  });

  it('truncates at the last complete file boundary once the patch exceeds the byte cap', async () => {
    const dir = makeRepo();
    const fileNames = ['f0.txt', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'];
    for (const name of fileNames) writeFileSync(join(dir, name), 'seed\n');
    git(dir, 'add', ...fileNames);
    commit(dir, 'init');
    // ~500KB of unique content per file, ~2.5MB combined — comfortably over the 2MB cap.
    for (const name of fileNames) writeFileSync(join(dir, name), bigLineBlock(500000, name));

    const diff = await Effect.runPromise(readGitDiff(dir, 'uncommitted'));
    expect(diff.truncated).toBe(true);
    expect(Buffer.byteLength(diff.patch, 'utf8')).toBeLessThanOrEqual(2 * 1024 * 1024);
    const fileCount = diff.patch.split('diff --git ').length - 1;
    expect(fileCount).toBeGreaterThan(0);
    expect(fileCount).toBeLessThan(fileNames.length);
    expect(diff.stat.files).toBe(fileCount);
  });

  it('diffs against the remote default branch in base mode', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    git(dir, 'add', 'a.txt');
    commit(dir, 'init');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    git(dir, 'checkout', '-b', 'feature');
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
    commit(dir, 'feature commit', 'a.txt');

    const diff = await Effect.runPromise(readGitDiff(dir, 'base'));
    expect(diff.patch).toContain('diff --git a/a.txt b/a.txt');
    expect(diff.stat).toEqual({ files: 1, additions: 1, deletions: 0 });
  });

  it('rejects base mode when no default branch can be resolved', async () => {
    const dir = makeRepo();
    commit(dir, 'init', '--allow-empty');
    await expect(Effect.runPromise(readGitDiff(dir, 'base'))).rejects.toThrow();
  });
});
