import { GitOverview } from '@linkcode/ui/shell/git';
import { useGitPullRequestStatus, useGitStatus } from './hooks';

/**
 * The right panel's Diff section content: a Git overview for the active session's working
 * directory. `cwd` is undefined when there is no active session.
 */
export function GitPanel({ cwd }: { cwd: string | undefined }): React.ReactNode {
  const { data: status, isLoading: statusLoading } = useGitStatus(cwd);
  const { data: pullRequest, isLoading: pullRequestLoading } = useGitPullRequestStatus(cwd);

  return (
    <GitOverview
      cwd={cwd}
      status={status}
      statusLoading={statusLoading}
      pullRequest={pullRequest}
      pullRequestLoading={pullRequestLoading}
      className="h-full"
    />
  );
}
