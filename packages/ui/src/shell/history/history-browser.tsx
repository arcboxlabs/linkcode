import type { AgentHistoryId } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { HistoryIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { repositoryLabel } from '../repository-label';
import { useRelativeTimeLabel } from '../use-relative-time-label';

/** One provider-local conversation, pre-resolved by the workbench container. */
export interface HistoryBrowserEntry {
  historyId: AgentHistoryId;
  title: string;
  cwd?: string;
  timestamp?: number;
  messageCount?: number;
  /** Already present in the session list — offer "open" instead of another import. */
  imported: boolean;
}

export interface HistoryBrowserListProps {
  entries: readonly HistoryBrowserEntry[];
  isLoading: boolean;
  /** The list fetch failure message, when there is nothing to show. */
  loadError?: string | null;
  importingId?: AgentHistoryId | null;
  /** The most recent import failure message; rendered inline, never swallowed. */
  importError?: string | null;
  onImport: (historyId: AgentHistoryId) => void;
  onOpen: (historyId: AgentHistoryId) => void;
  /** Backs the error state's Retry; the primary refresh control lives in the host's chrome. */
  onRefresh: () => void;
}

/** One provider's importable conversation rows (settings portal main pane). */
export function HistoryBrowserList({
  entries,
  isLoading,
  loadError,
  importingId,
  importError,
  onImport,
  onOpen,
  onRefresh,
}: HistoryBrowserListProps): React.ReactNode {
  const t = useTranslations('settings.historyImport');

  if (isLoading && entries.length === 0) {
    return (
      <div className="flex flex-col gap-1">
        {createFixedArray(5).map((index) => (
          <Skeleton key={index} className="h-13 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (entries.length === 0 && loadError != null) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <HistoryIcon />
        </EmptyMedia>
        <EmptyTitle>{t('loadFailedTitle')}</EmptyTitle>
        <EmptyDescription>{loadError}</EmptyDescription>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            {t('retry')}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <HistoryIcon />
        </EmptyMedia>
        <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('emptyHint')}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col">
      {importError != null && (
        <p className="pb-2 text-destructive text-xs">
          {t('importError', { message: importError })}
        </p>
      )}
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <HistoryBrowserRow
            key={entry.historyId}
            entry={entry}
            importing={importingId === entry.historyId}
            onImport={onImport}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </div>
  );
}

function HistoryBrowserRow({
  entry,
  importing,
  onImport,
  onOpen,
}: {
  entry: HistoryBrowserEntry;
  importing: boolean;
  onImport: (historyId: AgentHistoryId) => void;
  onOpen: (historyId: AgentHistoryId) => void;
}): React.ReactNode {
  const t = useTranslations('settings.historyImport');
  const timeLabel = useRelativeTimeLabel(entry.timestamp ?? 0);
  const meta = [
    entry.cwd ? repositoryLabel(entry.cwd) : null,
    entry.timestamp !== undefined ? timeLabel : null,
    entry.messageCount !== undefined ? t('messageCount', { count: entry.messageCount }) : null,
  ].filter(Boolean);

  return (
    <li className="-mx-3 flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        {/* No font-medium: the CJK fallback font renders it artificially bold. */}
        <div className="truncate text-sm">{entry.title}</div>
        {meta.length > 0 && (
          <div className="truncate text-muted-foreground text-xs">{meta.join(' · ')}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {entry.imported ? (
          <Badge size="sm" variant="secondary">
            {t('importedBadge')}
          </Badge>
        ) : (
          <Button
            size="xs"
            variant="outline"
            loading={importing}
            onClick={() => onImport(entry.historyId)}
          >
            {t('importAction')}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={importing}
          onClick={() => onOpen(entry.historyId)}
        >
          {t('open')}
        </Button>
      </div>
    </li>
  );
}
