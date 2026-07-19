import type { GitDiffMode, GitDiffStat, GitPullRequestStatus, GitStatus } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from 'coss-ui/components/empty';
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { ArrowRightIcon, ChevronDownIcon, GitBranchIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ShellIconButton } from '../shell-control';
import type { DiffStyle } from './diff-viewer';
import { GitPullRequestSection } from './pull-request-section';

export interface GitOverviewProps {
  /** The active session's working directory; undefined when there is no active session. */
  cwd: string | undefined;
  status: GitStatus | undefined;
  statusLoading: boolean;
  /** Set when the git status request itself failed (transport/daemon error), not a normal empty state. */
  statusError: unknown;
  pullRequest: GitPullRequestStatus | undefined;
  pullRequestLoading: boolean;
  mode: GitDiffMode;
  diffStyle: DiffStyle;
  stat: GitDiffStat;
  onModeChange: (mode: GitDiffMode) => void;
  onToggleDiffStyle: () => void;
  onRefresh: () => void;
  className?: string;
}

/** The right panel's Diff section content: a Git status + pull request overview for `cwd`. */
export function GitOverview({
  cwd,
  status,
  statusLoading,
  statusError,
  pullRequest,
  pullRequestLoading,
  mode,
  diffStyle,
  stat,
  onModeChange,
  onToggleDiffStyle,
  onRefresh,
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
    if (statusLoading) return <GitOverviewSkeleton className={className} />;

    return statusError ? (
      <GitOverviewEmpty
        className={className}
        title={t('statusErrorTitle')}
        description={t('statusErrorHint', {
          message: extractErrorMessage(statusError, false) ?? t('statusErrorUnknown'),
        })}
      />
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
    <div className={cn('shrink-0 border-border border-b px-3 py-2', className)}>
      <div className="flex h-7 min-w-0 items-center gap-1.5">
        <GitDiffScopeMenu
          hasRemote={status.remote !== null}
          mode={mode}
          onModeChange={onModeChange}
        />
        <div className="flex shrink-0 items-center gap-1.5 font-medium text-xs tabular-nums">
          {stat.additions > 0 && (
            <span className="text-success-foreground">
              {t('diff.additions', { count: stat.additions })}
            </span>
          )}
          {stat.deletions > 0 && (
            <span className="text-destructive-foreground">
              {t('diff.deletions', { count: stat.deletions })}
            </span>
          )}
        </div>
        <div className="flex-1" />
        <ShellIconButton label={t('diff.refresh')} onClick={onRefresh}>
          <RefreshCwIcon />
        </ShellIconButton>
        <DiffStyleButton diffStyle={diffStyle} onClick={onToggleDiffStyle} />
        <GitPullRequestSection pullRequest={pullRequest} loading={pullRequestLoading} />
      </div>
      <GitComparisonSummary status={status} pullRequest={pullRequest} mode={mode} />
    </div>
  );
}

function GitDiffScopeMenu({
  mode,
  hasRemote,
  onModeChange,
}: {
  mode: GitDiffMode;
  hasRemote: boolean;
  onModeChange: (mode: GitDiffMode) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.git.diff');

  return (
    <Menu>
      <MenuTrigger
        aria-label={t('scopeMenu')}
        render={<Button className="h-7 px-2 text-sm" size="xs" variant="secondary" />}
      >
        {t('scope')}
        <ChevronDownIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-48" sideOffset={6}>
        <MenuItem disabled>{t('unstaged')}</MenuItem>
        <MenuItem disabled>{t('staged')}</MenuItem>
        <MenuSub>
          <MenuSubTrigger>{t('commit')}</MenuSubTrigger>
          <MenuSubPopup className="w-56">
            <MenuItem disabled>{t('commitUnavailable')}</MenuItem>
          </MenuSubPopup>
        </MenuSub>
        <MenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (isGitDiffMode(value)) onModeChange(value);
          }}
        >
          <MenuRadioItem disabled={!hasRemote} value="base">
            {t('branch')}
          </MenuRadioItem>
          <MenuRadioItem value="uncommitted">{t('modeUncommitted')}</MenuRadioItem>
        </MenuRadioGroup>
        <MenuItem disabled>{t('previousTurn')}</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function isGitDiffMode(value: string): value is GitDiffMode {
  return value === 'uncommitted' || value === 'base';
}

function DiffStyleButton({
  diffStyle,
  onClick,
}: {
  diffStyle: DiffStyle;
  onClick: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.git.diff');
  const nextStyle = diffStyle === 'split' ? 'unified' : 'split';
  const button = (
    <Button
      aria-label={t('switchStyle', { style: t(nextStyle) })}
      className="border-transparent"
      onClick={onClick}
      size="icon-xs"
      variant="ghost"
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-4 overflow-hidden rounded-[3px] border border-foreground/20',
          diffStyle === 'split' ? 'grid-cols-2' : 'grid-rows-2',
        )}
      >
        <span className="bg-destructive/45" />
        <span className="bg-success/45" />
      </span>
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">{t('currentStyle', { style: t(diffStyle) })}</TooltipContent>
    </Tooltip>
  );
}

function GitComparisonSummary({
  status,
  pullRequest,
  mode,
}: {
  status: Extract<GitStatus, { isRepo: true }>;
  pullRequest: GitPullRequestStatus | undefined;
  mode: GitDiffMode;
}): React.ReactNode {
  const t = useTranslations('workbench.git');
  const pullRequestSummary = pullRequest?.status === 'ok' ? pullRequest.pullRequest : null;
  const comparisonTarget =
    mode === 'uncommitted'
      ? 'HEAD'
      : pullRequestSummary
        ? `origin/${pullRequestSummary.baseBranch}`
        : status.remote
          ? t('origin')
          : null;

  return (
    <div className="mt-1 flex min-w-0 items-center gap-2 px-1 text-muted-foreground text-xs">
      <span className="min-w-0 truncate">{status.branch ?? t('detachedHead')}</span>
      {comparisonTarget && (
        <>
          <ArrowRightIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{comparisonTarget}</span>
        </>
      )}
      {status.ahead !== null && status.ahead > 0 && (
        <span className="ml-auto shrink-0">{t('ahead', { count: status.ahead })}</span>
      )}
      {status.behind !== null && status.behind > 0 && (
        <span className="shrink-0">{t('behind', { count: status.behind })}</span>
      )}
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
    <div
      className={cn('flex h-[61px] shrink-0 flex-col gap-2 border-border border-b p-3', className)}
    >
      <div className="h-6 w-32 animate-pulse rounded-md bg-muted" />
      <div className="h-3 w-44 animate-pulse rounded bg-muted" />
    </div>
  );
}
