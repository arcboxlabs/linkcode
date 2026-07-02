import type {
  GitProviderBlocker,
  GitPullRequestStatus,
  GitPullRequestSummary,
} from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Skeleton } from 'coss-ui/components/skeleton';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

export function GitPullRequestSection({
  pullRequest,
  loading,
  className,
}: {
  pullRequest: GitPullRequestStatus | undefined;
  loading: boolean;
  className?: string;
}): React.ReactNode {
  if (loading && !pullRequest) return <GitPullRequestSectionSkeleton className={className} />;
  if (!pullRequest) return null;

  if (pullRequest.status === 'ok') {
    if (!pullRequest.pullRequest) return <GitNoPullRequestNotice className={className} />;
    return <GitPullRequestCard pullRequest={pullRequest.pullRequest} className={className} />;
  }

  if (pullRequest.status === 'error') {
    return <GitPullRequestErrorNotice message={pullRequest.message} className={className} />;
  }

  return <GitProviderBlockerNotice reason={pullRequest.reason} className={className} />;
}

const PR_STATE_BADGE_VARIANT = {
  open: 'success',
  closed: 'destructive',
  merged: 'info',
} as const satisfies Record<
  GitPullRequestSummary['state'],
  React.ComponentProps<typeof Badge>['variant']
>;

function GitPullRequestCard({
  pullRequest,
  className,
}: {
  pullRequest: GitPullRequestSummary;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.git');
  const tPrState = useTranslations('workbench.git.prState');
  const tChecksState = useTranslations('workbench.git.checksState');
  const tReviewDecision = useTranslations('workbench.git.reviewDecision');

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3', className)}
    >
      <div className="flex items-start gap-2">
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-medium text-sm hover:underline"
        >
          #{pullRequest.number} {pullRequest.title}
        </a>
        {pullRequest.isDraft && <Badge variant="outline">{t('draft')}</Badge>}
        <Badge variant={PR_STATE_BADGE_VARIANT[pullRequest.state]}>
          {tPrState(pullRequest.state)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <span>{tChecksState(pullRequest.checks)}</span>
        <span>{tReviewDecision(pullRequest.reviewDecision)}</span>
      </div>
    </div>
  );
}

function GitProviderBlockerNotice({
  reason,
  className,
}: {
  reason: GitProviderBlocker;
  className?: string;
}): React.ReactNode {
  const tTitle = useTranslations('workbench.git.blockerTitle');
  const t = useTranslations('workbench.git');
  const hint =
    reason === 'cli_not_installed'
      ? t('installGhHint')
      : reason === 'cli_not_authenticated'
        ? t('authGhHint')
        : null;

  return (
    <div className={cn('rounded-lg border border-border border-dashed p-3 text-xs', className)}>
      <p className="text-foreground">{tTitle(reason)}</p>
      {hint && <p className="mt-1 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function GitPullRequestErrorNotice({
  message,
  className,
}: {
  message: string;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.git');

  return (
    <div
      className={cn('rounded-lg border border-destructive/30 border-dashed p-3 text-xs', className)}
    >
      <p className="text-destructive-foreground">{t('pullRequestError', { message })}</p>
    </div>
  );
}

function GitNoPullRequestNotice({ className }: { className?: string }): React.ReactNode {
  const t = useTranslations('workbench.git');

  return (
    <div
      className={cn(
        'rounded-lg border border-border border-dashed p-3 text-muted-foreground text-xs',
        className,
      )}
    >
      {t('noPullRequest')}
    </div>
  );
}

function GitPullRequestSectionSkeleton({ className }: { className?: string }): React.ReactNode {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3', className)}
    >
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
