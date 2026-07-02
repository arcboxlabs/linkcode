import type { GitProviderKind, GitPullRequestStatus, GitRemoteIdentity } from '@linkcode/schema';

export interface PullRequestQuery {
  cwd: string;
  branch: string;
  identity: GitRemoteIdentity;
}

/**
 * One hosting-provider integration. Implementations own their transport entirely — the `gh` CLI
 * today, token-backed REST/GraphQL clients later — and answer in schema types only; nothing
 * implementation-specific may leak out. Expected degradation (CLI missing, not authenticated) is a
 * returned `unavailable` state, not a thrown error; throwing is reserved for genuine failures.
 */
export interface GitProviderClient {
  readonly kind: GitProviderKind;
  getPullRequestStatus(query: PullRequestQuery): Promise<GitPullRequestStatus>;
}
