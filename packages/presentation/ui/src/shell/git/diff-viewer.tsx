import type { FileDiffOptions } from '@pierre/diffs';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxts/create-fixed-array';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { FileDiffIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

export type DiffStyle = 'split' | 'unified';
export type DiffThemeType = 'light' | 'dark' | 'system';

export interface DiffViewerProps {
  patch: string;
  truncated: boolean;
  themeType: DiffThemeType;
  diffStyle: DiffStyle;
  isLoading: boolean;
  error: unknown;
  className?: string;
}

/** The right panel's Diff section content: a `@pierre/diffs` viewer for an already-fetched patch. */
export function DiffViewer({
  patch,
  truncated,
  themeType,
  diffStyle,
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
