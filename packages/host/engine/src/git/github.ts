import { existsSync } from 'node:fs';
import { executableSearchLocations } from '@linkcode/common/node';
import type {
  GitChecksState,
  GitPullRequestStatus,
  GitPullRequestSummary,
  GitReviewDecision,
} from '@linkcode/schema';
import { z } from 'zod';
import { runCommandPromise as runCommand } from '../process/run-command';
import type { GitProviderClient, PullRequestQuery } from './provider';

/** Never prompt: an interactive `gh` would hang the daemon's request until the timeout. */
const GH_ENV = { GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1' } as const;

/** PR lookups hit the GitHub API — allow more than local git probes get. */
const GH_TIMEOUT_MS = 20000;

const GH_PR_JSON_FIELDS =
  'number,title,url,state,isDraft,baseRefName,headRefName,reviewDecision,statusCheckRollup';

/** One entry of `statusCheckRollup`: classic status contexts carry `state`; check runs carry
 * `status` + `conclusion` (null until the run completes). */
const GhCheckSchema = z.object({
  state: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
});
type GhCheck = z.infer<typeof GhCheckSchema>;

const GhPrViewSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: z.boolean(),
  baseRefName: z.string(),
  headRefName: z.string(),
  reviewDecision: z.string().nullable().optional(),
  statusCheckRollup: z.array(GhCheckSchema).nullable().optional(),
});

const PR_STATE_MAP = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const;

const REVIEW_DECISION_MAP: Record<string, GitReviewDecision> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'review_required',
};

const FAILING_OUTCOMES = new Set([
  'FAILURE',
  'ERROR',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);

const AUTH_FAILURE_PATTERNS = [
  'gh auth login',
  'not logged in',
  'authentication failed',
  'bad credentials',
  'http 401',
  'gh_token',
];

/** Roll the head commit's checks up to one state. A failure outranks still-running checks. */
export function rollUpChecks(rollup: readonly GhCheck[] | null | undefined): GitChecksState {
  if (!rollup || rollup.length === 0) return 'none';
  let sawFailing = false;
  let sawPending = false;
  for (const check of rollup) {
    const outcome = check.state ?? (check.status === 'COMPLETED' ? check.conclusion : null);
    if (outcome == null || outcome === 'PENDING' || outcome === 'EXPECTED') sawPending = true;
    else if (FAILING_OUTCOMES.has(outcome)) sawFailing = true;
  }
  if (sawFailing) return 'failing';
  if (sawPending) return 'pending';
  return 'passing';
}

export function isAuthFailureStderr(stderr: string): boolean {
  const text = stderr.toLowerCase();
  return AUTH_FAILURE_PATTERNS.some((pattern) => text.includes(pattern));
}

function isNoPullRequestStderr(stderr: string): boolean {
  return stderr.toLowerCase().includes('no pull requests found');
}

/** Absolute path of the user's `gh`, resolved like the agent runtime probe (PATH scan, then
 * per-platform fallback install dirs — CODE-271): a GUI-launched daemon inherits launchd's bare
 * PATH, where a bare `spawn('gh')` misses a Homebrew install. Falls back to the bare name so an
 * absent gh still reports through the ENOENT → `cli_not_installed` path. Re-resolved per call —
 * a handful of stats against a 20s API call — so a gh installed mid-session is picked up. */
function resolveGhBinary(): string {
  const binary = process.platform === 'win32' ? 'gh.exe' : 'gh';
  return executableSearchLocations(binary).find((path) => existsSync(path)) ?? 'gh';
}

/** GitHub via the user's local `gh` CLI — auth is fully delegated to `gh auth login`; the daemon
 * never sees or stores a token. A token-backed client (LinkCode GitHub App) can later implement
 * the same {@link GitProviderClient} seam without touching the wire contract. */
export class GhCliGitHubClient implements GitProviderClient {
  readonly kind = 'github' as const;

  async getPullRequestStatus(query: PullRequestQuery): Promise<GitPullRequestStatus> {
    let result;
    try {
      // `gh pr view` resolves the PR for the checked-out branch (cwd-derived), open or merged.
      result = await runCommand(resolveGhBinary(), ['pr', 'view', '--json', GH_PR_JSON_FIELDS], {
        cwd: query.cwd,
        env: GH_ENV,
        timeoutMs: GH_TIMEOUT_MS,
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'unavailable', reason: 'cli_not_installed' };
      }
      throw err;
    }

    if (result.exitCode !== 0) {
      if (isAuthFailureStderr(result.stderr)) {
        return { status: 'unavailable', reason: 'cli_not_authenticated' };
      }
      if (isNoPullRequestStderr(result.stderr)) {
        return { status: 'ok', pullRequest: null };
      }
      return {
        status: 'error',
        message: 'GitHub CLI request failed',
      };
    }

    const parsed = GhPrViewSchema.parse(JSON.parse(result.stdout));
    const pullRequest: GitPullRequestSummary = {
      provider: 'github',
      number: parsed.number,
      title: parsed.title,
      url: parsed.url,
      state: PR_STATE_MAP[parsed.state],
      isDraft: parsed.isDraft,
      baseBranch: parsed.baseRefName,
      headBranch: parsed.headRefName,
      checks: rollUpChecks(parsed.statusCheckRollup),
      reviewDecision: REVIEW_DECISION_MAP[parsed.reviewDecision ?? ''] ?? 'none',
    };
    return { status: 'ok', pullRequest };
  }
}
