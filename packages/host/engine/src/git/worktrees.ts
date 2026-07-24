import { Effect } from 'effect';
import { runCommand } from '../process/run-command';

const READ_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const;
const WRITE_ENV = { GIT_TERMINAL_PROMPT: '0' } as const;
const MUTATION_TIMEOUT_MS = 120000;

const gitRead = Effect.fn('Git.worktreeRead')(function* (cwd: string, ...args: string[]) {
  return yield* runCommand('git', args, { cwd, env: READ_ENV });
});

export const resolveRepoRoot = Effect.fn('Git.resolveRepoRoot')(function* (cwd: string) {
  const result = yield* gitRead(cwd, 'rev-parse', '--show-toplevel');
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
});

export const readCurrentBranch = Effect.fn('Git.readCurrentBranch')(function* (repoRoot: string) {
  const result = yield* gitRead(repoRoot, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
});

export const localBranchExists = Effect.fn('Git.localBranchExists')(function* (
  repoRoot: string,
  branch: string,
) {
  const result = yield* gitRead(
    repoRoot,
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  );
  return result.exitCode === 0;
});

export const addWorktree = Effect.fn('Git.addWorktree')(function* (
  repoRoot: string,
  worktreePath: string,
  branch: string,
) {
  return yield* runCommand('git', ['worktree', 'add', '--', worktreePath, branch], {
    cwd: repoRoot,
    env: WRITE_ENV,
    timeoutMs: MUTATION_TIMEOUT_MS,
  });
});

export const removeWorktreeBestEffort = Effect.fn('Git.removeWorktreeBestEffort')(function* (
  repoRoot: string,
  worktreePath: string,
) {
  yield* runCommand('git', ['worktree', 'remove', '--force', '--', worktreePath], {
    cwd: repoRoot,
    env: WRITE_ENV,
    timeoutMs: MUTATION_TIMEOUT_MS,
  }).pipe(Effect.catch(() => Effect.void));
  yield* runCommand('git', ['worktree', 'prune'], {
    cwd: repoRoot,
    env: WRITE_ENV,
    timeoutMs: MUTATION_TIMEOUT_MS,
  }).pipe(Effect.catch(() => Effect.void));
});
