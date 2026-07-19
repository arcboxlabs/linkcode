import type { GitDiff, GitDiffMode, GitPullRequestStatus, GitStatus } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { TtlCache } from '../cache/ttl-cache';
import { readGitDiff } from './diff';
import { GhCliGitHubClient } from './github';
import type { GitProviderClient } from './provider';
import { readGitStatus } from './status';

/** Local git probes are cheap; keep the window just wide enough to absorb concurrent polls. */
const STATUS_TTL_MS = 5000;
/** Provider lookups hit the network and rate limits — cache them substantially longer. */
const PR_STATUS_TTL_MS = 30000;
/** A diff reads more of the tree than a status probe; still cheap enough to poll every few seconds. */
const DIFF_TTL_MS = 10000;

/**
 * Read-only git and hosting-provider state answering the `git.*` wire RPCs. Keyed by `cwd`
 * (every session on the same directory shares one view); TTL caches with in-flight dedup
 * converge any number of polling clients onto one underlying call.
 */
export class GitService {
  private readonly statusCache = new TtlCache<GitStatus>(STATUS_TTL_MS);
  private readonly prStatusCache = new TtlCache<GitPullRequestStatus>(PR_STATUS_TTL_MS);
  private readonly diffCache = new TtlCache<GitDiff>(DIFF_TTL_MS);
  private readonly providers: ReadonlyMap<string, GitProviderClient>;

  constructor(providers: readonly GitProviderClient[] = [new GhCliGitHubClient()]) {
    this.providers = new Map(providers.map((provider) => [provider.kind, provider]));
  }

  getStatus(cwd: string): Promise<GitStatus> {
    return this.statusCache.read(cwd, () => readGitStatus(cwd));
  }

  getDiff(cwd: string, mode: GitDiffMode): Promise<GitDiff> {
    // "::" can't appear in a directory path's mode slot, so this can't collide across (cwd, mode) pairs.
    return this.diffCache.read(`${cwd}::${mode}`, () => readGitDiff(cwd, mode));
  }

  getPullRequestStatus(cwd: string): Promise<GitPullRequestStatus> {
    return this.prStatusCache.read(cwd, async () => {
      const status = await this.getStatus(cwd);
      if (!status.isRepo) return { status: 'unavailable', reason: 'not_git_repo' };
      if (!status.remote) return { status: 'unavailable', reason: 'no_remote' };
      const identity = status.remote.identity;
      const provider = identity && this.providers.get(identity.provider);
      if (!identity || !provider) return { status: 'unavailable', reason: 'unsupported_remote' };
      // A detached HEAD has no branch, hence no change request to resolve.
      if (status.branch === null) return { status: 'ok', pullRequest: null };
      try {
        return await provider.getPullRequestStatus({ cwd, branch: status.branch, identity });
      } catch (err) {
        return {
          status: 'error',
          message: extractErrorMessage(err) ?? 'provider request failed',
        };
      }
    });
  }
}
