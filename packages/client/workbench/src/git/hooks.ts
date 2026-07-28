import type { GitDiffMode } from '@linkcode/schema';
import { getGitDiff, getGitPullRequestStatus, getGitStatus } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/**
 * Poll-based freshness: the daemon's per-cwd TTL caches converge every polling client onto one
 * underlying call (one RPC, not one subprocess, per tick). A daemon-side `git.*.updated` push
 * would be a purely additive replacement for these intervals.
 */
const GIT_STATUS_REFRESH_MS = 10000;
const GIT_DIFF_REFRESH_MS = 15000;
const PR_STATUS_REFRESH_MS = 60000;

/** Local git facts for a directory. Pass undefined to pause (e.g. no active session). */
export function useGitStatus(cwd: string | undefined) {
  return useData(getGitStatus, cwd === undefined ? null : { cwd }, {
    refreshInterval: GIT_STATUS_REFRESH_MS,
    keepPreviousData: true,
  });
}

/** A unified-diff patch for a directory. Pass undefined to pause (e.g. no active session). */
export function useGitDiff(cwd: string | undefined, mode: GitDiffMode) {
  return useData(getGitDiff, cwd === undefined ? null : { cwd, mode }, {
    refreshInterval: GIT_DIFF_REFRESH_MS,
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
