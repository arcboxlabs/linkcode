import { Effect } from 'effect';
import { runCommand } from '../process/run-command';

const READ_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } as const;
const WRITE_ENV = { GIT_TERMINAL_PROMPT: '0' } as const;
const MUTATION_TIMEOUT_MS = 120000;
const RE_ZERO = /^0\s*$/;
const RE_TRAILING_SLASH = /\/$/;

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

export const switchBranch = Effect.fn('Git.switchBranch')(function* (
  repoRoot: string,
  branch: string,
) {
  return yield* runCommand('git', ['switch', '--no-guess', '--', branch], {
    cwd: repoRoot,
    env: WRITE_ENV,
    timeoutMs: MUTATION_TIMEOUT_MS,
  });
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
  // Only for rolling back a newly-created worktree whose first ownership save failed. Normal
  // lifecycle cleanup must use removeWorktree(), whose non-force check is the TOCTOU safety bound.
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

export const inspectWorktreeCleanup = Effect.fn('Git.inspectWorktreeCleanup')(function* (
  worktreePath: string,
  expectedBranch?: string,
) {
  const branch = yield* gitRead(worktreePath, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch.exitCode !== 0 || !branch.stdout.trim()) return false;
  if (expectedBranch !== undefined && branch.stdout.trim() !== expectedBranch) return false;
  const status = yield* gitRead(worktreePath, 'status', '--porcelain', '--untracked-files=all');
  if (status.exitCode !== 0 || status.stdout.length !== 0) return false;
  const upstream = yield* gitRead(
    worktreePath,
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  );
  if (upstream.exitCode !== 0 || !upstream.stdout.trim()) return false;
  const ahead = yield* gitRead(worktreePath, 'rev-list', '--count', '@{upstream}..HEAD');
  return ahead.exitCode === 0 && RE_ZERO.test(ahead.stdout);
});

export const removeWorktree = Effect.fn('Git.removeWorktree')(function* (
  repoRoot: string,
  worktreePath: string,
) {
  return yield* runCommand('git', ['worktree', 'remove', '--', worktreePath], {
    cwd: repoRoot,
    env: WRITE_ENV,
    timeoutMs: MUTATION_TIMEOUT_MS,
  });
});

export const pruneWorktrees = Effect.fn('Git.pruneWorktrees')(function* (repoRoot: string) {
  return yield* runCommand('git', ['worktree', 'prune'], {
    cwd: repoRoot,
    env: WRITE_ENV,
    timeoutMs: MUTATION_TIMEOUT_MS,
  });
});

export const identifyManagedWorktree = Effect.fn('Git.identifyManagedWorktree')(function* (
  candidate: string,
) {
  const common = yield* gitRead(
    candidate,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  );
  if (common.exitCode !== 0 || !common.stdout.trim()) return;
  const branch = yield* gitRead(candidate, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch.exitCode !== 0 || !branch.stdout.trim()) return;
  const list = yield* gitRead(candidate, 'worktree', 'list', '--porcelain', '-z');
  if (list.exitCode !== 0) return;
  const paths = list.stdout.split('\0').reduce<string[]>((found, line) => {
    if (line.startsWith('worktree ')) found.push(line.slice('worktree '.length).trim());
    return found;
  }, []);
  const candidatePath = yield* Effect.sync(() => normalizePath(candidate));
  const commonPath = yield* Effect.sync(() => normalizePath(common.stdout.trim()));
  if (!paths.some((path) => normalizePath(path) === candidatePath)) return;
  // A standalone repository placed under the managed root is not a LinkCode worktree. A linked
  // worktree's common git directory lives with its main checkout, outside the candidate itself.
  if (commonPath === candidatePath || commonPath.startsWith(`${candidatePath}/`)) return;
  const repoRoot = paths[0];
  if (!repoRoot || normalizePath(repoRoot) === candidatePath) return;
  const repoCommon = yield* gitRead(
    repoRoot,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  );
  if (repoCommon.exitCode !== 0 || normalizePath(repoCommon.stdout.trim()) !== commonPath) return;
  return { repoRoot, branch: branch.stdout.trim() };
});

function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(RE_TRAILING_SLASH, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
