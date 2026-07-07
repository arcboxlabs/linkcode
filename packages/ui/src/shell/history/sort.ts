import { repositoryLabel } from '../repository-label';
import type { HistoryBrowserEntry } from './history-browser';

/** How the history browser arranges entries: by project directory, or by recency. */
export type HistorySortOrder = 'project' | 'latest' | 'oldest';

export function sortHistoryBrowserEntries(
  entries: readonly HistoryBrowserEntry[],
  order: HistorySortOrder,
): HistoryBrowserEntry[] {
  const sorted = [...entries];
  if (order === 'project') {
    // Alphabetical project clusters, most recent first within each; entries without a cwd last.
    // The full-cwd tiebreak keeps same-named directories adjacent per directory, so
    // `groupHistoryBrowserEntries` can partition consecutively.
    return sorted.sort((a, b) => {
      if (a.cwd === undefined || b.cwd === undefined) {
        if (a.cwd !== b.cwd) return a.cwd === undefined ? 1 : -1;
        return byTimestampDesc(a, b);
      }
      return (
        repositoryLabel(a.cwd).localeCompare(repositoryLabel(b.cwd)) ||
        a.cwd.localeCompare(b.cwd) ||
        byTimestampDesc(a, b)
      );
    });
  }
  if (order === 'oldest') return sorted.sort((a, b) => -byTimestampDesc(a, b));
  return sorted.sort(byTimestampDesc);
}

export interface HistoryBrowserGroup {
  /** The grouping key (full cwd); undefined for the trailing no-project bucket. */
  cwd?: string;
  /** Display label (`repositoryLabel(cwd)`); null for the no-project bucket — host translates. */
  label: string | null;
  entries: HistoryBrowserEntry[];
}

/** Partitions project-sorted entries into consecutive per-directory groups. */
export function groupHistoryBrowserEntries(
  sorted: readonly HistoryBrowserEntry[],
): HistoryBrowserGroup[] {
  const groups: HistoryBrowserGroup[] = [];
  for (const entry of sorted) {
    const last = groups.at(-1);
    if (last && last.cwd === entry.cwd) {
      last.entries.push(entry);
      continue;
    }
    groups.push({
      cwd: entry.cwd,
      label: entry.cwd === undefined ? null : repositoryLabel(entry.cwd),
      entries: [entry],
    });
  }
  return groups;
}

function byTimestampDesc(a: HistoryBrowserEntry, b: HistoryBrowserEntry): number {
  return (b.timestamp ?? 0) - (a.timestamp ?? 0);
}
