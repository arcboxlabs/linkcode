import { getGitPullRequestStatus, getGitStatus } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Freshness is poll-based for now: the daemon's per-cwd TTL caches (5s status / 30s PR) converge
 * every polling client onto one underlying call, so these intervals cost one RPC, not one
 * subprocess, per tick. A daemon-side watcher pushing `git.*.updated` events is a purely additive
 * upgrade that would replace the intervals.
 */
const GIT_STATUS_REFRESH_MS = 10_000;
const PR_STATUS_REFRESH_MS = 60_000;

/** Local git facts for a directory. Pass undefined to pause (e.g. no active session). */
export function useGitStatus(cwd: string | undefined) {
  return useData(getGitStatus, cwd === undefined ? null : { cwd }, {
    refreshInterval: GIT_STATUS_REFRESH_MS,
    keepPreviousData: true,
  });
}

/** Hosting-provider PR state for a directory's current branch. */
export function useGitPullRequestStatus(cwd: string | undefined) {
  return useData(getGitPullRequestStatus, cwd === undefined ? null : { cwd }, {
    refreshInterval: PR_STATUS_REFRESH_MS,
    keepPreviousData: true,
  });
}
