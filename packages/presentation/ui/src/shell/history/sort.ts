import { repositoryLabel } from '../../repository-label';
import type { HistoryBrowserEntry } from './history-browser';

/** How the history browser arranges entries: by project directory, or by recency. */
export type HistorySortOrder = 'project' | 'latest' | 'oldest';

const collator = new Intl.Collator();

export function sortHistoryBrowserEntries(
  entries: readonly HistoryBrowserEntry[],
  order: HistorySortOrder,
): HistoryBrowserEntry[] {
  const sorted = [...entries];
  if (order === 'project') {
    // Alphabetical project clusters, most recent first, no-cwd entries last; the full-cwd tiebreak
    // keeps same-named directories adjacent so `groupHistoryBrowserEntries` can partition consecutively.
    return sorted.sort((a, b) => {
      if (a.cwd === undefined || b.cwd === undefined) {
        if (a.cwd !== b.cwd) return a.cwd === undefined ? 1 : -1;
        return byTimestampDesc(a, b);
      }
      return (
        collator.compare(repositoryLabel(a.cwd), repositoryLabel(b.cwd)) ||
        collator.compare(a.cwd, b.cwd) ||
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

/** Groups by full directory while preserving the first occurrence order from the selected sort. */
export function groupHistoryBrowserEntries(
  sorted: readonly HistoryBrowserEntry[],
): HistoryBrowserGroup[] {
  const groups: HistoryBrowserGroup[] = [];
  const byCwd = new Map<string | undefined, HistoryBrowserGroup>();
  for (let i = 0, len = sorted.length; i < len; i++) {
    const entry = sorted[i];
    const existing = byCwd.get(entry.cwd);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }
    const group = {
      cwd: entry.cwd,
      label: entry.cwd === undefined ? null : repositoryLabel(entry.cwd),
      entries: [entry],
    };
    byCwd.set(entry.cwd, group);
    groups.push(group);
  }
  return groups;
}

function byTimestampDesc(a: HistoryBrowserEntry, b: HistoryBrowserEntry): number {
  return (b.timestamp ?? 0) - (a.timestamp ?? 0);
}
