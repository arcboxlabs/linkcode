import type { GitBranch } from '@linkcode/schema';
import { Effect } from 'effect';
import { runCommand } from '../process/run-command';

const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const;
const FIELD_SEPARATOR = '\0';

const git = Effect.fn('Git.branchCommand')(function* (cwd: string, ...args: string[]) {
  return yield* runCommand('git', args, { cwd, env: GIT_ENV });
});

/** List local branches only, with the current branch first and all others newest-tip first. */
export const readGitBranches = Effect.fn('Git.readBranches')(function* (cwd: string) {
  const repo = yield* git(cwd, 'rev-parse', '--git-dir').pipe(
    Effect.catch(() => Effect.succeed(null)),
  );
  if (repo?.exitCode !== 0) return { isRepo: false } as const;

  const result = yield* git(
    cwd,
    'for-each-ref',
    '--format=%(refname:short)%00%(HEAD)%00%(committerdate:unix)',
    'refs/heads',
  );
  if (result.exitCode !== 0) return { isRepo: false } as const;

  const branches: GitBranch[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue;
    const [name, head, committedAt] = line.split(FIELD_SEPARATOR);
    if (!name) continue;
    branches.push({
      name,
      isCurrent: head === '*',
      lastCommitAt: Number(committedAt) * 1000,
    });
  }
  branches.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return right.lastCommitAt - left.lastCommitAt;
  });
  return { isRepo: true as const, branches };
});
