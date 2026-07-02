import type { GitStatus } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Skeleton } from 'coss-ui/components/skeleton';
import { GitBranchIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

type RepoGitStatus = Extract<GitStatus, { isRepo: true }>;

export function GitBranchSummary({
  status,
  className,
}: {
  status: RepoGitStatus;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.git');

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3', className)}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{status.branch ?? t('detachedHead')}</span>
        {status.dirtyFileCount > 0 && (
          <Badge variant="warning">{t('dirtyCount', { count: status.dirtyFileCount })}</Badge>
        )}
        {status.ahead !== null && status.ahead > 0 && (
          <span className="text-muted-foreground text-xs">
            {t('ahead', { count: status.ahead })}
          </span>
        )}
        {status.behind !== null && status.behind > 0 && (
          <span className="text-muted-foreground text-xs">
            {t('behind', { count: status.behind })}
          </span>
        )}
      </div>
      <div className="text-muted-foreground text-xs">
        {status.remote?.identity
          ? `${status.remote.identity.owner}/${status.remote.identity.repo}`
          : t('noRemote')}
      </div>
    </div>
  );
}

export function GitBranchSummarySkeleton({ className }: { className?: string }): React.ReactNode {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-3', className)}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}
