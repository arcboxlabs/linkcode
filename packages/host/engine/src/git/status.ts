import type { GitRemote, GitStatus } from '@linkcode/schema';
import { runCommandPromise as runCommand } from '../process/run-command';
import { parseRemoteIdentity } from './remote';

/** Read-only git env: never prompt for credentials, never take optional locks — a status probe
 * must not contend with a concurrently running agent's git for `index.lock`. */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const;

/** Output of `rev-list --left-right --count`: "<ahead>\t<behind>". */
const LEFT_RIGHT_COUNT = /^(\d+)\s+(\d+)/;

function git(cwd: string, ...args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return runCommand('git', args, { cwd, env: GIT_ENV });
}

/** Resolve the local git facts for a directory. Every command is read-only. */
export async function readGitStatus(cwd: string): Promise<GitStatus> {
  let repoRoot: string;
  try {
    const result = await git(cwd, 'rev-parse', '--show-toplevel');
    repoRoot = result.stdout.trim();
    if (result.exitCode !== 0 || repoRoot.length === 0) return { isRepo: false };
  } catch {
    // git itself is missing or not runnable — indistinguishable from "no repo" for the data plane.
    return { isRepo: false };
  }

  const [branch, dirtyFileCount, upstream, remote] = await Promise.all([
    readBranch(cwd),
    readDirtyFileCount(cwd),
    readAheadBehind(cwd),
    readRemote(cwd),
  ]);

  return {
    isRepo: true,
    repoRoot,
    branch,
    dirtyFileCount,
    ahead: upstream.ahead,
    behind: upstream.behind,
    remote,
  };
}

async function readBranch(cwd: string): Promise<string | null> {
  const result = await git(cwd, 'branch', '--show-current');
  const branch = result.stdout.trim();
  // Empty output on a detached HEAD.
  return result.exitCode === 0 && branch.length > 0 ? branch : null;
}

async function readDirtyFileCount(cwd: string): Promise<number> {
  const result = await git(cwd, 'status', '--porcelain');
  if (result.exitCode !== 0) return 0;
  let count = 0;
  for (const line of result.stdout.split('\n')) {
    if (line.length > 0) count += 1;
  }
  return count;
}

async function readAheadBehind(
  cwd: string,
): Promise<{ ahead: number | null; behind: number | null }> {
  // Exits non-zero when the branch has no upstream (or HEAD is detached).
  const result = await git(cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}');
  if (result.exitCode !== 0) return { ahead: null, behind: null };
  const match = LEFT_RIGHT_COUNT.exec(result.stdout.trim());
  if (!match) return { ahead: null, behind: null };
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

async function readRemote(cwd: string): Promise<GitRemote | null> {
  const result = await git(cwd, 'remote', 'get-url', 'origin');
  const url = result.stdout.trim();
  if (result.exitCode !== 0 || url.length === 0) return null;
  return { url, identity: parseRemoteIdentity(url) };
}
