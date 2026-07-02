import type { GitPullRequestStatus, GitStatus } from '@linkcode/schema';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from 'coss-ui/components/empty';
import { GitBranchIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { GitBranchSummary, GitBranchSummarySkeleton } from './branch-summary';
import { GitPullRequestSection } from './pull-request-section';

export interface GitOverviewProps {
  /** The active session's working directory; undefined when there is no active session. */
  cwd: string | undefined;
  status: GitStatus | undefined;
  statusLoading: boolean;
  pullRequest: GitPullRequestStatus | undefined;
  pullRequestLoading: boolean;
  className?: string;
}

/** The right panel's Diff section content: a Git status + pull request overview for `cwd`. */
export function GitOverview({
  cwd,
  status,
  statusLoading,
  pullRequest,
  pullRequestLoading,
  className,
}: GitOverviewProps): React.ReactNode {
  const t = useTranslations('workbench.git');

  if (cwd === undefined) {
    return (
      <GitOverviewEmpty
        className={className}
        title={t('emptyTitle')}
        description={t('emptyHint')}
      />
    );
  }

  if (!status) {
    return statusLoading ? (
      <GitOverviewSkeleton className={className} />
    ) : (
      <GitOverviewEmpty
        className={className}
        title={t('notRepoTitle')}
        description={t('notRepoHint')}
      />
    );
  }

  if (!status.isRepo) {
    return (
      <GitOverviewEmpty
        className={className}
        title={t('notRepoTitle')}
        description={t('notRepoHint')}
      />
    );
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3', className)}>
      <GitBranchSummary status={status} />
      <GitPullRequestSection pullRequest={pullRequest} loading={pullRequestLoading} />
    </div>
  );
}

function GitOverviewEmpty({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}): React.ReactNode {
  return (
    <Empty className={className}>
      <EmptyMedia variant="icon">
        <GitBranchIcon />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </Empty>
  );
}

function GitOverviewSkeleton({ className }: { className?: string }): React.ReactNode {
  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3 p-3', className)}>
      <GitBranchSummarySkeleton />
    </div>
  );
}
