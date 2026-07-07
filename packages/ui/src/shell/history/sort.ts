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
    return sorted.sort((a, b) => {
      if (a.cwd === undefined || b.cwd === undefined) {
        if (a.cwd !== b.cwd) return a.cwd === undefined ? 1 : -1;
        return byTimestampDesc(a, b);
      }
      return repositoryLabel(a.cwd).localeCompare(repositoryLabel(b.cwd)) || byTimestampDesc(a, b);
    });
  }
  if (order === 'oldest') return sorted.sort((a, b) => -byTimestampDesc(a, b));
  return sorted.sort(byTimestampDesc);
}

function byTimestampDesc(a: HistoryBrowserEntry, b: HistoryBrowserEntry): number {
  return (b.timestamp ?? 0) - (a.timestamp ?? 0);
}
