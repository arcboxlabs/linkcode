import type { GitDiffMode } from '@linkcode/schema';
import type { DiffStyle, DiffThemeType } from '@linkcode/ui/shell/git';
import { DiffViewer, GitOverview } from '@linkcode/ui/shell/git';
import { Button } from 'coss-ui/components/button';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useGitDiff, useGitPullRequestStatus, useGitStatus } from './hooks';

/**
 * The right panel's Diff section: a Git overview header (branch/PR, tightened to its content
 * height) followed by the diff viewer for the active session's working directory. `cwd` is
 * undefined when there is no active session.
 */
export function GitPanel({
  cwd,
  themeType,
}: {
  cwd: string | undefined;
  themeType: DiffThemeType;
}): React.ReactNode {
  const { data: status, isLoading: statusLoading, error: statusError } = useGitStatus(cwd);
  const { data: pullRequest, isLoading: pullRequestLoading } = useGitPullRequestStatus(cwd);
  const hasRemote = status?.isRepo === true && status.remote !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GitOverview
        cwd={cwd}
        status={status}
        statusLoading={statusLoading}
        statusError={statusError}
        pullRequest={pullRequest}
        pullRequestLoading={pullRequestLoading}
        className="h-auto shrink-0 overflow-visible border-b border-border"
      />
      {cwd !== undefined && (
        // Keyed by `cwd`: switching the working directory resets the mode/diffStyle preference
        // rather than carrying an unrelated directory's stale toggle state forward.
        <GitDiffSection key={cwd} cwd={cwd} hasRemote={hasRemote} themeType={themeType} />
      )}
    </div>
  );
}

function GitDiffSection({
  cwd,
  hasRemote,
  themeType,
}: {
  cwd: string;
  hasRemote: boolean;
  themeType: DiffThemeType;
}): React.ReactNode {
  const t = useTranslations('workbench.git.diff');
  const [mode, setMode] = useState<GitDiffMode>('uncommitted');
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split');
  const { data: diff, isLoading, error, mutate } = useGitDiff(cwd, mode);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Button
          variant="outline"
          size="xs"
          data-pressed={mode === 'uncommitted' ? '' : undefined}
          onClick={() => setMode('uncommitted')}
        >
          {t('modeUncommitted')}
        </Button>
        {hasRemote && (
          <Button
            variant="outline"
            size="xs"
            data-pressed={mode === 'base' ? '' : undefined}
            onClick={() => setMode('base')}
          >
            {t('modeBase')}
          </Button>
        )}
      </div>
      <DiffViewer
        className="min-h-0 flex-1"
        patch={diff?.patch ?? ''}
        truncated={diff?.truncated ?? false}
        stat={diff?.stat ?? { files: 0, additions: 0, deletions: 0 }}
        themeType={themeType}
        diffStyle={diffStyle}
        onToggleDiffStyle={() =>
          setDiffStyle((current) => (current === 'split' ? 'unified' : 'split'))
        }
        onRefresh={() => {
          void mutate();
        }}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
