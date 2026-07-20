import type { GitDiffMode } from '@linkcode/schema';
import type { DiffStyle, DiffThemeType } from '@linkcode/ui/shell/git';
import { DiffViewer, GitOverview } from '@linkcode/ui/shell/git';
import { useState } from 'react';
import { useGitDiff, useGitPullRequestStatus, useGitStatus } from './hooks';

/**
 * The right panel's Diff section: Git overview header plus the diff viewer for the active
 * session's working directory. `cwd` is undefined when there is no active session.
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

  return (
    // Keyed by `cwd`: switching the working directory resets the mode/diffStyle preference rather
    // than carrying an unrelated directory's stale toggle state forward.
    <GitPanelContent
      key={cwd ?? ''}
      cwd={cwd}
      themeType={themeType}
      status={status}
      statusLoading={statusLoading}
      statusError={statusError}
      pullRequest={pullRequest}
      pullRequestLoading={pullRequestLoading}
    />
  );
}

function GitPanelContent({
  cwd,
  themeType,
  status,
  statusLoading,
  statusError,
  pullRequest,
  pullRequestLoading,
}: {
  cwd: string | undefined;
  themeType: DiffThemeType;
  status: ReturnType<typeof useGitStatus>['data'];
  statusLoading: boolean;
  statusError: unknown;
  pullRequest: ReturnType<typeof useGitPullRequestStatus>['data'];
  pullRequestLoading: boolean;
}): React.ReactNode {
  const [selectedMode, setSelectedMode] = useState<GitDiffMode>();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split');
  const isRepo = status?.isRepo === true;
  const hasRemote = isRepo && status.remote !== null;
  const mode = selectedMode ?? (hasRemote ? 'base' : 'uncommitted');
  const { data: diff, isLoading, error, mutate } = useGitDiff(isRepo ? cwd : undefined, mode);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GitOverview
        cwd={cwd}
        status={status}
        statusLoading={statusLoading}
        statusError={statusError}
        pullRequest={pullRequest}
        pullRequestLoading={pullRequestLoading}
        mode={mode}
        diffStyle={diffStyle}
        stat={diff?.stat ?? { files: 0, additions: 0, deletions: 0 }}
        onModeChange={setSelectedMode}
        onToggleDiffStyle={() =>
          setDiffStyle((current) => (current === 'split' ? 'unified' : 'split'))
        }
        onRefresh={() => {
          void mutate();
        }}
        className="h-auto shrink-0"
      />
      {cwd !== undefined && isRepo && (
        <DiffViewer
          className="min-h-0 flex-1"
          patch={diff?.patch ?? ''}
          truncated={diff?.truncated ?? false}
          themeType={themeType}
          diffStyle={diffStyle}
          isLoading={isLoading}
          error={error}
        />
      )}
    </div>
  );
}
