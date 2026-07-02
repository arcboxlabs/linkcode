import { z } from 'zod';

/**
 * Git data contracts (data plane). Capability-shaped and provider-neutral: the wire never names the
 * daemon-side implementation (today plain `git` plus the GitHub `gh` CLI; later token-backed API
 * clients). Everything here is keyed by `cwd` — git state is directory-backed and shared by every
 * session on the same directory, never owned by a session.
 */

/** Hosting providers the contract reserves vocabulary for. Only `github` is implemented today. */
export const GitProviderKindSchema = z.enum(['github', 'gitlab', 'bitbucket']);
export type GitProviderKind = z.infer<typeof GitProviderKindSchema>;

/** A remote URL resolved to a hosting-provider repository. */
export const GitRemoteIdentitySchema = z.object({
  provider: GitProviderKindSchema,
  host: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
});
export type GitRemoteIdentity = z.infer<typeof GitRemoteIdentitySchema>;

/** The `origin` remote as local git reports it; `identity` is null when no supported provider matches. */
export const GitRemoteSchema = z.object({
  url: z.string().min(1),
  identity: GitRemoteIdentitySchema.nullable(),
});
export type GitRemote = z.infer<typeof GitRemoteSchema>;

/** Local git facts for one directory. Purely local — resolving this never touches the network. */
export const GitStatusSchema = z.discriminatedUnion('isRepo', [
  z.object({ isRepo: z.literal(false) }),
  z.object({
    isRepo: z.literal(true),
    repoRoot: z.string().min(1),
    /** Current branch name; null on a detached HEAD. */
    branch: z.string().nullable(),
    /** Files with uncommitted changes: staged, unstaged, and untracked. */
    dirtyFileCount: z.number().int().nonnegative(),
    /** Commits ahead of / behind the upstream; null when the branch has no upstream. */
    ahead: z.number().int().nonnegative().nullable(),
    behind: z.number().int().nonnegative().nullable(),
    /** The `origin` remote; null when the repo has none. */
    remote: GitRemoteSchema.nullable(),
  }),
]);
export type GitStatus = z.infer<typeof GitStatusSchema>;

/** Which base a diff is computed against. `base` compares HEAD against the merge-base with the
 * remote's default branch; `uncommitted` compares the working tree (tracked + untracked) against HEAD. */
export const GitDiffModeSchema = z.enum(['uncommitted', 'base']);
export type GitDiffMode = z.infer<typeof GitDiffModeSchema>;

/** Line-count summary derived from the patch text itself, not from a separate `git diff --stat` call. */
export const GitDiffStatSchema = z.object({
  files: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type GitDiffStat = z.infer<typeof GitDiffStatSchema>;

/** A unified-diff patch for a directory, capped in size — `truncated` marks a cut made at a file
 * boundary (never mid-file) to stay under the cap. */
export const GitDiffSchema = z.object({
  patch: z.string(),
  truncated: z.boolean(),
  stat: GitDiffStatSchema,
});
export type GitDiff = z.infer<typeof GitDiffSchema>;

/**
 * Why the provider layer cannot answer for a directory. These are expected product states — clients
 * hide the surface or show a setup hint (e.g. "run `gh auth login`") — not errors.
 */
export const GitProviderBlockerSchema = z.enum([
  'not_git_repo',
  'no_remote',
  'unsupported_remote',
  'cli_not_installed',
  'cli_not_authenticated',
]);
export type GitProviderBlocker = z.infer<typeof GitProviderBlockerSchema>;

export const GitPullRequestStateSchema = z.enum(['open', 'closed', 'merged']);
export type GitPullRequestState = z.infer<typeof GitPullRequestStateSchema>;

/** Rolled-up CI state across the head commit's checks. `none` = the provider reports no checks. */
export const GitChecksStateSchema = z.enum(['none', 'pending', 'passing', 'failing']);
export type GitChecksState = z.infer<typeof GitChecksStateSchema>;

export const GitReviewDecisionSchema = z.enum([
  'approved',
  'changes_requested',
  'review_required',
  'none',
]);
export type GitReviewDecision = z.infer<typeof GitReviewDecisionSchema>;

/** Provider-neutral summary of a change request (GitHub/Bitbucket "PR", GitLab "MR"). */
export const GitPullRequestSummarySchema = z.object({
  provider: GitProviderKindSchema,
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().min(1),
  state: GitPullRequestStateSchema,
  isDraft: z.boolean(),
  baseBranch: z.string().min(1),
  headBranch: z.string().min(1),
  checks: GitChecksStateSchema,
  reviewDecision: GitReviewDecisionSchema,
});
export type GitPullRequestSummary = z.infer<typeof GitPullRequestSummarySchema>;

/**
 * The provider's answer for a directory's current branch. `ok` with a null `pullRequest` means the
 * branch simply has none; `unavailable` carries a {@link GitProviderBlocker}; `error` carries a
 * genuine provider failure (network, rate limit, unexpected output).
 */
export const GitPullRequestStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), pullRequest: GitPullRequestSummarySchema.nullable() }),
  z.object({ status: z.literal('unavailable'), reason: GitProviderBlockerSchema }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
export type GitPullRequestStatus = z.infer<typeof GitPullRequestStatusSchema>;
