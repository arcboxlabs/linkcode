import type { AgentHistorySession } from '@linkcode/schema';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { HistoryIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { AGENT_LABELS, AgentIcon } from '../agent-icon';

export interface HistoryListProps {
  entries: readonly AgentHistorySession[];
  isLoading: boolean;
  /** The historyId currently being imported, if any — disables that row while the import is in flight. */
  importingHistoryId?: string | null;
  /** Set when the most recent import attempt failed; rendered inline, never swallowed. */
  importError?: unknown;
  /** Set when every agent kind's history fetch has failed and there is nothing to show. */
  loadFailed?: boolean;
  onImport: (entry: AgentHistorySession) => void;
  className?: string;
}

/** Provider-local history for a workspace's `cwd`, each entry importable as a new thread. */
export function HistoryList({
  entries,
  isLoading,
  importingHistoryId,
  importError,
  loadFailed,
  onImport,
  className,
}: HistoryListProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  if (isLoading && entries.length === 0) {
    return (
      <div className={cn('space-y-1', className)}>
        {createFixedArray(3).map((i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (entries.length === 0 && loadFailed) {
    return (
      <p className={cn('px-2 py-1 text-muted-foreground text-xs', className)}>
        {t('historyLoadError')}
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <Empty className={className}>
        <EmptyMedia variant="icon">
          <HistoryIcon />
        </EmptyMedia>
        <EmptyTitle>{t('historyEmptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('historyEmptyHint')}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <ul className={cn('space-y-0.5', className)}>
      {importError != null && (
        <li className="px-2 py-1 text-destructive text-xs">
          {t('importError', { message: extractErrorMessage(importError, false) ?? '' })}
        </li>
      )}
      {entries.map((entry) => (
        <li key={entry.historyId}>
          <button
            type="button"
            disabled={importingHistoryId === entry.historyId}
            onClick={() => onImport(entry)}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64"
          >
            <AgentIcon kind={entry.kind} />
            <span className="min-w-0 flex-1 truncate text-sm">
              {entry.title ?? AGENT_LABELS[entry.kind]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
