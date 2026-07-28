import type { GitDiff, GitPullRequestStatus, GitStatus } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';

export interface GitFixture {
  status: GitStatus;
  prStatus: GitPullRequestStatus;
  diff: GitDiff;
}

const EMPTY_DIFF: GitDiff = {
  patch: '',
  truncated: false,
  stat: { files: 0, additions: 0, deletions: 0 },
};

const RICH_DIFF: GitDiff = {
  patch:
    "diff --git a/mock.ts b/mock.ts\nindex 0000000..1111111 100644\n--- a/mock.ts\n+++ b/mock.ts\n@@ -1 +1 @@\n-const mode = 'daemon';\n+const mode = 'mock';\n",
  truncated: false,
  stat: { files: 1, additions: 1, deletions: 1 },
};

const MOCK_REMOTE = {
  url: 'https://github.com/linkcode/mock.git',
  identity: {
    provider: 'github',
    host: 'github.com',
    owner: 'linkcode',
    repo: 'mock',
  },
} as const;

/**
 * Per-cwd fixtures so each seeded workspace exercises a different UI branch: a dirty repo with a
 * troubled PR, a clean repo with no PR, and a directory that isn't a repo at all.
 */
const FIXTURES = new Map<string, GitFixture>(
  Object.entries({
    '/mock/linkcode': {
      status: {
        isRepo: true,
        repoRoot: '/mock/linkcode',
        branch: 'mock-host',
        dirtyFileCount: 3,
        ahead: 1,
        behind: 2,
        remote: MOCK_REMOTE,
      },
      prStatus: {
        status: 'ok',
        pullRequest: {
          provider: 'github',
          number: 42,
          title: 'Mock host data-plane coverage',
          url: 'https://github.com/linkcode/mock/pull/42',
          state: 'open',
          isDraft: false,
          baseBranch: 'main',
          headBranch: 'mock-host',
          checks: 'failing',
          reviewDecision: 'changes_requested',
        },
      },
      diff: RICH_DIFF,
    },
    '/mock/platform': {
      status: {
        isRepo: true,
        repoRoot: '/mock/platform',
        branch: 'main',
        dirtyFileCount: 0,
        ahead: 0,
        behind: 0,
        remote: MOCK_REMOTE,
      },
      prStatus: { status: 'ok', pullRequest: null },
      diff: EMPTY_DIFF,
    },
    '/mock/scratch': {
      status: { isRepo: false },
      prStatus: { status: 'unavailable', reason: 'not_git_repo' },
      diff: EMPTY_DIFF,
    },
  } satisfies Record<string, GitFixture>).map(([cwd, fixture]) => [normalizeCwdKey(cwd), fixture]),
);

/** Unknown directories (fresh sessions) answer as a plain dirty repo with no PR. */
export function gitFixtureFor(cwd: string): GitFixture {
  return (
    FIXTURES.get(normalizeCwdKey(cwd)) ?? {
      status: {
        isRepo: true,
        repoRoot: cwd,
        branch: 'mock-host',
        dirtyFileCount: 1,
        ahead: 1,
        behind: 0,
        remote: MOCK_REMOTE,
      },
      prStatus: { status: 'ok', pullRequest: null },
      diff: RICH_DIFF,
    }
  );
}
