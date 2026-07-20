import type { GitProviderKind, GitPullRequestStatus, GitRemoteIdentity } from '@linkcode/schema';
import type { Effect } from 'effect';
import { Data } from 'effect';

export interface PullRequestQuery {
  cwd: string;
  branch: string;
  identity: GitRemoteIdentity;
}

export class GitProviderError extends Data.TaggedError('GitProviderError')<{
  readonly operation: 'command' | 'response';
  readonly cause: unknown;
}> {}

/**
 * One hosting-provider integration. Implementations own their transport and answer in schema
 * types only — nothing implementation-specific may leak out. Expected degradation (CLI missing,
 * not authenticated) is a returned `unavailable` state, not a thrown error.
 */
export interface GitProviderClient {
  readonly kind: GitProviderKind;
  getPullRequestStatus(
    query: PullRequestQuery,
  ): Effect.Effect<GitPullRequestStatus, GitProviderError>;
}
