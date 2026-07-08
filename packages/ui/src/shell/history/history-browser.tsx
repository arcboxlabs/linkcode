import type { AgentHistoryId } from '@linkcode/schema';
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
import { CheckIcon, FolderIcon, HistoryIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { repositoryLabel } from '../repository-label';
import { useRelativeTimeLabel } from '../use-relative-time-label';
import { groupHistoryBrowserEntries } from './sort';

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
  /** Pre-sorted by the container; with `groupByProject`, project-sorted (clustered per cwd). */
  entries: readonly HistoryBrowserEntry[];
  /** Renders sidebar-style project section headers (folder + name + count) between clusters. */
  groupByProject?: boolean;
  /** The provider has more history beyond these entries — renders a truncation hint. */
  truncated?: boolean;
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
  groupByProject,
  truncated,
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

  const rows = (groupEntries: readonly HistoryBrowserEntry[]): React.ReactNode => (
    <ul className="flex flex-col">
      {groupEntries.map((entry) => (
        <HistoryBrowserRow
          key={entry.historyId}
          entry={entry}
          // The section header already names the project; keep grouped row meta to time · count.
          showProject={!groupByProject}
          importing={importingId === entry.historyId}
          onImport={onImport}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col">
      {importError != null && (
        <p className="pb-2 text-destructive text-xs">
          {t('importError', { message: importError })}
        </p>
      )}
      {groupByProject ? (
        <div className="flex flex-col gap-5">
          {groupHistoryBrowserEntries(entries).map((group) => (
            <section key={group.cwd ?? 'no-project'}>
              <div
                className="flex items-center gap-1.5 pb-1 font-medium text-muted-foreground text-xs"
                title={group.cwd}
              >
                <FolderIcon className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{group.label ?? t('noProject')}</span>
                <span className="ml-auto shrink-0">{group.entries.length}</span>
              </div>
              {rows(group.entries)}
            </section>
          ))}
        </div>
      ) : (
        rows(entries)
      )}
      {truncated && (
        <p className="pt-3 text-center text-muted-foreground text-xs">
          {t('showingLatest', { count: entries.length })}
        </p>
      )}
    </div>
  );
}

function HistoryBrowserRow({
  entry,
  showProject,
  importing,
  onImport,
  onOpen,
}: {
  entry: HistoryBrowserEntry;
  showProject: boolean;
  importing: boolean;
  onImport: (historyId: AgentHistoryId) => void;
  onOpen: (historyId: AgentHistoryId) => void;
}): React.ReactNode {
  const t = useTranslations('settings.historyImport');
  const timeLabel = useRelativeTimeLabel(entry.timestamp ?? 0);
  const meta = [
    showProject && entry.cwd ? repositoryLabel(entry.cwd) : null,
    entry.timestamp === undefined ? null : timeLabel,
    entry.messageCount === undefined ? null : t('messageCount', { count: entry.messageCount }),
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
          <>
            <span className="flex items-center" title={t('importedBadge')}>
              <CheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="sr-only">{t('importedBadge')}</span>
            </span>
            <Button size="xs" variant="ghost" onClick={() => onOpen(entry.historyId)}>
              {t('open')}
            </Button>
          </>
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
      </div>
    </li>
  );
}
