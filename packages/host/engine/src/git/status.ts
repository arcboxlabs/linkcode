import type { GitRemote } from '@linkcode/schema';
import { Effect } from 'effect';
import { runCommand } from '../process/run-command';
import { parseRemoteIdentity } from './remote';

/** Read-only git env: never prompt for credentials, never take optional locks — a status probe
 * must not contend with a concurrently running agent's git for `index.lock`. */
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const;

/** Output of `rev-list --left-right --count`: "<ahead>\t<behind>". */
const LEFT_RIGHT_COUNT = /^(\d+)\s+(\d+)/;

const git = Effect.fn('Git.statusCommand')(function* (cwd: string, ...args: string[]) {
  return yield* runCommand('git', args, { cwd, env: GIT_ENV });
});

const readBranch = Effect.fn('Git.readBranch')(function* (cwd: string) {
  const result = yield* git(cwd, 'branch', '--show-current');
  const branch = result.stdout.trim();
  // Empty output on a detached HEAD.
  return result.exitCode === 0 && branch.length > 0 ? branch : null;
});

const readDirtyFileCount = Effect.fn('Git.readDirtyFileCount')(function* (cwd: string) {
  const result = yield* git(cwd, 'status', '--porcelain');
  if (result.exitCode !== 0) return 0;
  let count = 0;
  for (const line of result.stdout.split('\n')) {
    if (line.length > 0) count += 1;
  }
  return count;
});

const readAheadBehind = Effect.fn('Git.readAheadBehind')(function* (cwd: string) {
  // Exits non-zero when the branch has no upstream (or HEAD is detached).
  const result = yield* git(cwd, 'rev-list', '--left-right', '--count', 'HEAD...@{upstream}');
  if (result.exitCode !== 0) return { ahead: null, behind: null };
  const match = LEFT_RIGHT_COUNT.exec(result.stdout.trim());
  if (!match) return { ahead: null, behind: null };
  return { ahead: Number(match[1]), behind: Number(match[2]) };
});

const readRemote = Effect.fn('Git.readRemote')(function* (cwd: string) {
  const result = yield* git(cwd, 'remote', 'get-url', 'origin');
  const url = result.stdout.trim();
  if (result.exitCode !== 0 || url.length === 0) return null;
  return { url, identity: parseRemoteIdentity(url) } satisfies GitRemote;
});

/** Resolve the local git facts for a directory. Every command is read-only. */
export const readGitStatus = Effect.fn('Git.readStatus')(function* (cwd: string) {
  const result = yield* git(cwd, 'rev-parse', '--show-toplevel').pipe(
    // git itself is missing or not runnable — indistinguishable from "no repo" for the data plane.
    Effect.catch(() => Effect.succeed(null)),
  );
  const repoRoot = result?.stdout.trim() ?? '';
  if (result?.exitCode !== 0 || repoRoot.length === 0) return { isRepo: false } as const;

  const [branch, dirtyFileCount, upstream, remote] = yield* Effect.all(
    [readBranch(cwd), readDirtyFileCount(cwd), readAheadBehind(cwd), readRemote(cwd)],
    { concurrency: 'unbounded' },
  );

  return {
    isRepo: true as const,
    repoRoot,
    branch,
    dirtyFileCount,
    ahead: upstream.ahead,
    behind: upstream.behind,
    remote,
  };
});
