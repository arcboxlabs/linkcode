import type { GitDiffStat } from '@linkcode/schema';
import type { FileDiffOptions } from '@pierre/diffs';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxts/create-fixed-array';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { FileDiffIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ShellIconButton } from '../shell-control';

export type DiffStyle = 'split' | 'unified';
export type DiffThemeType = 'light' | 'dark' | 'system';

export interface DiffViewerProps {
  patch: string;
  truncated: boolean;
  stat: GitDiffStat;
  themeType: DiffThemeType;
  diffStyle: DiffStyle;
  onToggleDiffStyle: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  error: unknown;
  className?: string;
}

/** The right panel's Diff section content: a `@pierre/diffs` viewer for an already-fetched patch. */
export function DiffViewer({
  patch,
  truncated,
  stat,
  themeType,
  diffStyle,
  onToggleDiffStyle,
  onRefresh,
  isLoading,
  error,
  className,
}: DiffViewerProps): React.ReactNode {
  const t = useTranslations('workbench.git.diff');
  const options = useMemo<FileDiffOptions<undefined>>(
    () => ({ themeType, diffStyle }),
    [themeType, diffStyle],
  );
  // `parsePatchFiles` returns one `ParsedPatch` per commit boundary in the raw text; our own
  // patches are never multi-commit, but flattening stays correct either way.
  const files = useMemo(
    () => (patch.length > 0 ? parsePatchFiles(patch).flatMap((parsed) => parsed.files) : []),
    [patch],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <DiffToolbar
        stat={stat}
        diffStyle={diffStyle}
        onToggleDiffStyle={onToggleDiffStyle}
        onRefresh={onRefresh}
      />
      {truncated && (
        <div className="flex items-center gap-2 border-b border-dashed border-border px-3 py-2 text-warning-foreground text-xs">
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span>{t('truncatedHint')}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 ? (
          isLoading ? (
            <DiffViewerSkeleton />
          ) : error ? (
            <DiffViewerEmpty
              title={t('errorTitle')}
              description={t('errorHint', { message: extractErrorMessage(error, false) ?? '' })}
            />
          ) : (
            <DiffViewerEmpty title={t('emptyTitle')} description={t('emptyHint')} />
          )
        ) : (
          files.map((fileDiff) => (
            <FileDiff key={fileDiff.name} fileDiff={fileDiff} options={options} />
          ))
        )}
      </div>
    </div>
  );
}

function DiffToolbar({
  stat,
  diffStyle,
  onToggleDiffStyle,
  onRefresh,
}: {
  stat: GitDiffStat;
  diffStyle: DiffStyle;
  onToggleDiffStyle: () => void;
  onRefresh: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.git.diff');

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
        {stat.additions > 0 && (
          <span className="text-success-foreground">
            {t('additions', { count: stat.additions })}
          </span>
        )}
        {stat.deletions > 0 && (
          <span className="text-destructive-foreground">
            {t('deletions', { count: stat.deletions })}
          </span>
        )}
      </div>
      <Button
        variant="outline"
        size="xs"
        data-pressed={diffStyle === 'split' ? '' : undefined}
        onClick={diffStyle === 'unified' ? onToggleDiffStyle : undefined}
      >
        {t('split')}
      </Button>
      <Button
        variant="outline"
        size="xs"
        data-pressed={diffStyle === 'unified' ? '' : undefined}
        onClick={diffStyle === 'split' ? onToggleDiffStyle : undefined}
      >
        {t('unified')}
      </Button>
      <ShellIconButton label={t('refresh')} onClick={onRefresh}>
        <RefreshCwIcon className="size-4" />
      </ShellIconButton>
    </div>
  );
}

function DiffViewerEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.ReactNode {
  return (
    <Empty className="h-full">
      <EmptyMedia variant="icon">
        <FileDiffIcon />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </Empty>
  );
}

function DiffViewerSkeleton(): React.ReactNode {
  return (
    <div className="flex flex-col gap-3 p-3">
      {createFixedArray(4).map((i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}
