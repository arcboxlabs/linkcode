import type { GitBranchSwitchCheck, GitChangedFile } from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import { runCommand } from '../process/run-command';

const gitEnv = { LC_ALL: 'C' };
const MUTATION_TIMEOUT_MS = 120000;
const NUMSTAT_PATTERN = /^\d+$/;

const gitCommand = Effect.fn('Git.command')(function* (
  cwd: string,
  args: readonly string[],
  publicMessage: string,
  allowFailure = false,
  timeoutMs?: number,
) {
  const result = yield* runCommand('git', args, { cwd, env: gitEnv, timeoutMs }).pipe(
    Effect.mapError(
      (cause) => new OperationError({ subsystem: 'git', operation: args[0], publicMessage, cause }),
    ),
  );
  if (!allowFailure && result.exitCode !== 0) {
    return yield* new OperationError({
      subsystem: 'git',
      operation: args[0],
      publicMessage,
      cause: result,
    });
  }
  return result;
});

function git(
  cwd: string,
  args: readonly string[],
  publicMessage: string,
  allowFailure = false,
  timeoutMs?: number,
) {
  return gitCommand(cwd, args, publicMessage, allowFailure, timeoutMs);
}

const readNumstatCommand = Effect.fn('Git.readNumstat')(function* (cwd: string, path: string) {
  const result = yield* git(
    cwd,
    ['diff', '--numstat', 'HEAD', '--', path],
    'Failed to inspect git change',
  );
  const [additions, deletions] = result.stdout.split('\t', 2);
  const numeric = NUMSTAT_PATTERN.test(additions) && NUMSTAT_PATTERN.test(deletions);
  return {
    path,
    additions: numeric ? Number(additions) : null,
    deletions: numeric ? Number(deletions) : null,
  } satisfies GitChangedFile;
});

function readNumstat(cwd: string, path: string) {
  return readNumstatCommand(cwd, path);
}

export const checkGitBranchSwitch = Effect.fn('Git.checkBranchSwitch')(function* (
  cwd: string,
  branch: string,
) {
  const root = yield* git(
    cwd,
    ['rev-parse', '--show-toplevel'],
    'Failed to inspect git repository',
  );
  const repoRoot = root.stdout.trim();
  const current = yield* git(
    repoRoot,
    ['branch', '--show-current'],
    'Failed to inspect git branch',
  );
  if (current.stdout.trim() === branch) return { status: 'ready' } as const;

  const target = yield* git(
    repoRoot,
    ['rev-parse', '--verify', `refs/heads/${branch}`],
    'Failed to find git branch',
    true,
  );
  if (target.exitCode !== 0) {
    return yield* new RequestError({ code: 'not_found', message: 'Git branch not found' });
  }
  const status = yield* git(
    repoRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    'Failed to inspect local changes',
  );
  const changed = parseStatusPaths(status.stdout);
  const diff = yield* git(
    repoRoot,
    ['diff', '--name-only', '-z', 'HEAD', branch, '--'],
    'Failed to compare git branches',
  );
  const branchPaths = new Set(splitNul(diff.stdout));
  const conflicts = [...changed].filter((path) => branchPaths.has(path)).sort();
  if (conflicts.length === 0) return { status: 'ready' } as const;
  const files = yield* Effect.forEach(conflicts, (path) => readNumstat(repoRoot, path));
  return { status: 'conflict', files } satisfies GitBranchSwitchCheck;
});

export const createGitBranch = Effect.fn('Git.createBranch')(function* (
  cwd: string,
  branch: string,
) {
  const validation = yield* git(
    cwd,
    ['check-ref-format', '--branch', branch],
    'Failed to validate git branch',
    true,
  );
  if (validation.exitCode !== 0) {
    return yield* new RequestError({ code: 'invalid_request', message: 'Invalid git branch name' });
  }
  const existing = yield* git(
    cwd,
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    'Failed to inspect git branch',
    true,
  );
  if (existing.exitCode === 0) {
    return yield* new RequestError({ code: 'conflict', message: 'Git branch already exists' });
  }
  if (existing.exitCode !== 1) {
    return yield* new OperationError({
      subsystem: 'git',
      operation: 'show-ref',
      publicMessage: 'Failed to inspect git branch',
      cause: existing,
    });
  }
  yield* git(
    cwd,
    ['branch', '--', branch, 'HEAD'],
    'Failed to create git branch',
    false,
    MUTATION_TIMEOUT_MS,
  );
});

export const commitGitChanges = Effect.fn('Git.commitChanges')(function* (
  cwd: string,
  rawMessage: string,
) {
  const message = rawMessage.trim();
  if (message.length === 0) {
    return yield* new RequestError({
      code: 'invalid_request',
      message: 'Commit message is required',
    });
  }
  yield* git(cwd, ['add', '--all'], 'Failed to stage git changes', false, MUTATION_TIMEOUT_MS);
  yield* git(
    cwd,
    ['commit', '-m', message],
    'Failed to commit git changes',
    false,
    MUTATION_TIMEOUT_MS,
  );
});

function parseStatusPaths(output: string): Set<string> {
  const entries = splitNul(output);
  const paths = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    paths.add(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') {
      paths.add(entries[index + 1]);
      index += 1;
    }
  }
  return paths;
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((value) => value.length > 0);
}
