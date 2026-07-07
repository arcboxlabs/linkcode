import type { AgentHistoryId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { HistoryBrowserEntry } from '../history-browser';
import { sortHistoryBrowserEntries } from '../sort';

function entry(
  historyId: string,
  overrides: Partial<Omit<HistoryBrowserEntry, 'historyId'>> = {},
): HistoryBrowserEntry {
  return {
    historyId: historyId as AgentHistoryId,
    title: historyId,
    imported: false,
    ...overrides,
  };
}

function ids(entries: readonly HistoryBrowserEntry[]): string[] {
  return entries.map((item) => item.historyId);
}

describe('sortHistoryBrowserEntries', () => {
  const fixtures = [
    entry('old-linkcode', { cwd: '/w/linkcode', timestamp: 10 }),
    entry('new-platform', { cwd: '/w/platform', timestamp: 40 }),
    entry('no-cwd', { timestamp: 30 }),
    entry('new-linkcode', { cwd: '/w/linkcode', timestamp: 20 }),
  ];

  it('latest sorts by timestamp descending', () => {
    expect(ids(sortHistoryBrowserEntries(fixtures, 'latest'))).toEqual([
      'new-platform',
      'no-cwd',
      'new-linkcode',
      'old-linkcode',
    ]);
  });

  it('oldest reverses the recency order', () => {
    expect(ids(sortHistoryBrowserEntries(fixtures, 'oldest'))).toEqual([
      'old-linkcode',
      'new-linkcode',
      'no-cwd',
      'new-platform',
    ]);
  });

  it('project clusters alphabetically, recency within, missing cwd last', () => {
    expect(ids(sortHistoryBrowserEntries(fixtures, 'project'))).toEqual([
      'new-linkcode',
      'old-linkcode',
      'new-platform',
      'no-cwd',
    ]);
  });

  it('does not mutate the input', () => {
    const input = [...fixtures];
    sortHistoryBrowserEntries(input, 'project');
    expect(ids(input)).toEqual(ids(fixtures));
  });
});
