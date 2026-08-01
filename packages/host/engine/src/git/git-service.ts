import type {
  GitBranchList,
  GitBranchSwitchCheck,
  GitDiff,
  GitDiffMode,
  GitPullRequestStatus,
  GitStatus,
} from '@linkcode/schema';
import { Cache, Effect, Exit } from 'effect';
import type { EngineFailure } from '../failure';
import { OperationError, toOperationFailure } from '../failure';
import { readGitBranches } from './branches';
import { readGitDiff } from './diff';
import { GhCliGitHubClient } from './github';
import { checkGitBranchSwitch, commitGitChanges, createGitBranch } from './mutations';
import type { GitProviderClient } from './provider';
import { readGitStatus } from './status';

/** Local git probes are cheap; keep the window just wide enough to absorb concurrent polls. */
const STATUS_TTL_MS = 5000;
/** Provider lookups hit the network and rate limits — cache them substantially longer. */
const PR_STATUS_TTL_MS = 30000;
/** A diff reads more of the tree than a status probe; still cheap enough to poll every few seconds. */
const DIFF_TTL_MS = 10000;
const CACHE_CAPACITY = 256;
type GitDiffKey = readonly [cwd: string, mode: GitDiffMode];

/**
 * Read-only git and hosting-provider state answering the `git.*` wire RPCs. Keyed by `cwd`
 * (every session on the same directory shares one view); TTL caches with in-flight dedup
 * converge any number of polling clients onto one underlying call.
 */
export class GitService {
  private constructor(
    private readonly statusCache: Cache.Cache<string, GitStatus, EngineFailure>,
    private readonly branchListCache: Cache.Cache<string, GitBranchList, EngineFailure>,
    private readonly prStatusCache: Cache.Cache<string, GitPullRequestStatus, EngineFailure>,
    private readonly diffCache: Cache.Cache<GitDiffKey, GitDiff, EngineFailure>,
  ) {}

  static readonly make = Effect.fn('GitService.make')(function* (
    providers: readonly GitProviderClient[] = [new GhCliGitHubClient()],
  ) {
    const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
    const statusCache = yield* makeCache(
      (cwd: string) =>
        readGitStatus(cwd).pipe(
          Effect.mapError((cause) =>
            toOperationFailure(cause, {
              subsystem: 'git',
              operation: 'git.status',
              publicMessage: 'Failed to read git status',
            }),
          ),
        ),
      STATUS_TTL_MS,
    );
    const branchListCache = yield* makeCache(
      (cwd: string) =>
        readGitBranches(cwd).pipe(
          Effect.mapError((cause) =>
            toOperationFailure(cause, {
              subsystem: 'git',
              operation: 'git.branch.list',
              publicMessage: 'Failed to list git branches',
            }),
          ),
        ),
      STATUS_TTL_MS,
    );
    const diffCache = yield* makeCache(
      ([cwd, mode]: GitDiffKey) =>
        readGitDiff(cwd, mode).pipe(
          Effect.mapError((cause) =>
            toOperationFailure(cause, {
              subsystem: 'git',
              operation: 'git.diff',
              publicMessage: 'Failed to read git diff',
            }),
          ),
        ),
      DIFF_TTL_MS,
    );
    const prStatusCache = yield* Cache.makeWith(
      (cwd: string) =>
        Effect.gen(function* () {
          const status = yield* Cache.get(statusCache, cwd);
          if (!status.isRepo) return { status: 'unavailable', reason: 'not_git_repo' } as const;
          if (!status.remote) return { status: 'unavailable', reason: 'no_remote' } as const;
          const identity = status.remote.identity;
          const provider = identity && byKind.get(identity.provider);
          if (!identity || !provider) {
            return { status: 'unavailable', reason: 'unsupported_remote' } as const;
          }
          const branch = status.branch;
          if (branch === null) return { status: 'ok', pullRequest: null } as const;
          return yield* provider.getPullRequestStatus({ cwd, branch, identity }).pipe(
            Effect.mapError(
              (cause) =>
                new OperationError({
                  subsystem: 'git',
                  operation: 'git.provider',
                  publicMessage: 'Provider request failed',
                  cause,
                }),
            ),
            Effect.tapError((error) =>
              Effect.logError(
                error.publicMessage,
                { operation: error.operation, subsystem: error.subsystem },
                error.cause,
              ),
            ),
            Effect.catch(() =>
              Effect.succeed({ status: 'error', message: 'Provider request failed' } as const),
            ),
          );
        }),
      {
        capacity: CACHE_CAPACITY,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && exit.value.status !== 'error' ? PR_STATUS_TTL_MS : 0,
      },
    );
    return new GitService(statusCache, branchListCache, prStatusCache, diffCache);
  });

  getStatus(cwd: string): Effect.Effect<GitStatus, EngineFailure> {
    return Cache.get(this.statusCache, cwd);
  }

  listBranches(cwd: string): Effect.Effect<GitBranchList, EngineFailure> {
    return Cache.get(this.branchListCache, cwd);
  }

  getDiff(cwd: string, mode: GitDiffMode): Effect.Effect<GitDiff, EngineFailure> {
    return Cache.get(this.diffCache, [cwd, mode]);
  }

  getPullRequestStatus(cwd: string): Effect.Effect<GitPullRequestStatus, EngineFailure> {
    return Cache.get(this.prStatusCache, cwd);
  }

  checkBranchSwitch(
    cwd: string,
    branch: string,
  ): Effect.Effect<GitBranchSwitchCheck, EngineFailure> {
    return checkGitBranchSwitch(cwd, branch);
  }

  createBranch(cwd: string, branch: string): Effect.Effect<void, EngineFailure> {
    return createGitBranch(cwd, branch).pipe(Effect.andThen(this.invalidate(cwd)));
  }

  commitChanges(cwd: string, message: string): Effect.Effect<void, EngineFailure> {
    return commitGitChanges(cwd, message).pipe(Effect.andThen(this.invalidate(cwd)));
  }

  /** Drop cwd-scoped reads after a git mutation so the next poll observes it immediately. */
  invalidate(cwd: string): Effect.Effect<void> {
    return Effect.all([
      Cache.invalidate(this.statusCache, cwd),
      Cache.invalidate(this.branchListCache, cwd),
      Cache.invalidate(this.prStatusCache, cwd),
      Cache.invalidate(this.diffCache, [cwd, 'uncommitted']),
      Cache.invalidate(this.diffCache, [cwd, 'base']),
    ]).pipe(Effect.asVoid);
  }
}

function makeCache<Key, A, E>(lookup: (key: Key) => Effect.Effect<A, E>, ttl: number) {
  return Cache.makeWith(lookup, {
    capacity: CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? ttl : 0),
  });
}
