import type { GitPullRequestStatus, GitPullRequestSummary } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Menu, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from 'coss-ui/components/menu';
import { Skeleton } from 'coss-ui/components/skeleton';
import { ChevronDownIcon, CircleDotIcon, ExternalLinkIcon, GitPullRequestIcon } from 'lucide-react';
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
  if (pullRequest?.status !== 'ok' || !pullRequest.pullRequest) return null;

  return <GitPullRequestButton pullRequest={pullRequest.pullRequest} className={className} />;
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
              tPrState(pullRequest.state),
              tChecksState(pullRequest.checks),
              tReviewDecision(pullRequest.reviewDecision),
            ].map((v) => (
              <span
                className="text-xs bg-secondary rounded-full px-1 py-0.1 text-primary/60"
                key={v}
              >
                <CircleDotIcon size={10} className="inline mr-1 opacity-80" />
                {v}
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
