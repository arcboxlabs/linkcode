import type { GitPullRequestStatus, GitPullRequestSummary } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Menu, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from 'coss-ui/components/menu';
import { Skeleton } from 'coss-ui/components/skeleton';
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
} from 'lucide-react';
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

  if (pullRequest.status !== 'ok' || !pullRequest.pullRequest) {
    return <GitPullRequestNoticeButton pullRequest={pullRequest} className={className} />;
  }

  return <GitPullRequestButton pullRequest={pullRequest.pullRequest} className={className} />;
}

function GitPullRequestNoticeButton({
  pullRequest,
  className,
}: {
  pullRequest: GitPullRequestStatus;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.git');
  const tBlocker = useTranslations('workbench.git.blockerTitle');
  const title =
    pullRequest.status === 'ok'
      ? t('noPullRequest')
      : pullRequest.status === 'error'
        ? t('pullRequestError', { message: pullRequest.message })
        : tBlocker(pullRequest.reason);
  const hint =
    pullRequest.status === 'unavailable'
      ? pullRequest.reason === 'cli_not_installed'
        ? t('installGhHint')
        : pullRequest.reason === 'cli_not_authenticated'
          ? t('authGhHint')
          : null
      : null;
  const isError = pullRequest.status === 'error';

  return (
    <Menu>
      <MenuTrigger
        aria-label={title}
        render={
          <Button
            className={cn(isError && 'text-destructive-foreground', className)}
            size="icon-xs"
            title={title}
            variant="ghost"
          />
        }
      >
        {isError ? <CircleAlertIcon /> : <GitPullRequestIcon />}
      </MenuTrigger>
      <MenuPopup align="end" className="w-72" sideOffset={6}>
        <div className="px-2 py-1.5 text-sm">
          <p className={cn(isError && 'text-destructive-foreground')}>{title}</p>
          {hint && <p className="mt-1 text-muted-foreground text-xs">{hint}</p>}
        </div>
      </MenuPopup>
    </Menu>
  );
}

function GitPullRequestButton({
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
    <Menu>
      <MenuTrigger render={<Button className={className} size="xs" variant={'outline'} />}>
        <GitPullRequestIcon />
        <span>#{pullRequest.number}</span>
        <ChevronDownIcon className="size-3" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-72" sideOffset={6}>
        <div className="flex min-w-0 flex-col gap-2 px-2 py-1.5">
          <p className="line-clamp-2 font-medium text-sm leading-snug">{pullRequest.title}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {pullRequest.isDraft && <Badge variant="outline">{t('draft')}</Badge>}
            {[
              { key: 'state', label: tPrState(pullRequest.state) },
              { key: 'checks', label: tChecksState(pullRequest.checks) },
              { key: 'review', label: tReviewDecision(pullRequest.reviewDecision) },
            ].map(({ key, label }) => (
              <span
                className="rounded-full bg-secondary px-1 py-0.5 text-primary/60 text-xs"
                key={key}
              >
                <CircleDotIcon className="mr-1 inline opacity-80" size={10} />
                {label}
              </span>
            ))}
          </div>
        </div>
        <MenuSeparator />
        <MenuLinkItem href={pullRequest.url} rel="noreferrer" target="_blank">
          {t('openPullRequest')}
          <ExternalLinkIcon className="ml-auto" />
        </MenuLinkItem>
      </MenuPopup>
    </Menu>
  );
}

function GitPullRequestSectionSkeleton({ className }: { className?: string }): React.ReactNode {
  return <Skeleton className={cn('h-6 w-16', className)} />;
}
