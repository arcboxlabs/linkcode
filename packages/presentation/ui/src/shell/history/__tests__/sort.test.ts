import type { AgentHistoryId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { HistoryBrowserEntry } from '../history-browser';
import { groupHistoryBrowserEntries, sortHistoryBrowserEntries } from '../sort';

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

  it('keeps same-named directories from different paths adjacent per directory', () => {
    const twins = [
      entry('a-work', { cwd: '/a/work', timestamp: 30 }),
      entry('b-work-new', { cwd: '/b/work', timestamp: 40 }),
      entry('a-work-old', { cwd: '/a/work', timestamp: 10 }),
    ];
    expect(ids(sortHistoryBrowserEntries(twins, 'project'))).toEqual([
      'a-work',
      'a-work-old',
      'b-work-new',
    ]);
  });
});

describe('groupHistoryBrowserEntries', () => {
  it('partitions project-sorted entries into labeled per-directory groups', () => {
    const sorted = sortHistoryBrowserEntries(
      [
        entry('old-linkcode', { cwd: '/w/linkcode', timestamp: 10 }),
        entry('new-platform', { cwd: '/w/platform', timestamp: 40 }),
        entry('no-cwd', { timestamp: 30 }),
        entry('new-linkcode', { cwd: '/w/linkcode', timestamp: 20 }),
      ],
      'project',
    );

    const groups = groupHistoryBrowserEntries(sorted);
    expect(groups.map((group) => ({ label: group.label, entries: ids(group.entries) }))).toEqual([
      { label: 'linkcode', entries: ['new-linkcode', 'old-linkcode'] },
      { label: 'platform', entries: ['new-platform'] },
      { label: null, entries: ['no-cwd'] },
    ]);
  });

  it('keeps same-named directories from different paths as separate groups', () => {
    const sorted = sortHistoryBrowserEntries(
      [entry('a', { cwd: '/a/work', timestamp: 1 }), entry('b', { cwd: '/b/work', timestamp: 2 })],
      'project',
    );
    expect(groupHistoryBrowserEntries(sorted).map((group) => group.cwd)).toEqual([
      '/a/work',
      '/b/work',
    ]);
  });

  it('forms stable groups even when the selected time sort interleaves directories', () => {
    const latest = sortHistoryBrowserEntries(
      [
        entry('a-new', { cwd: '/a/work', timestamp: 40 }),
        entry('b', { cwd: '/b/work', timestamp: 30 }),
        entry('a-old', { cwd: '/a/work', timestamp: 20 }),
        entry('no-cwd-new', { timestamp: 35 }),
        entry('no-cwd-old', { timestamp: 10 }),
      ],
      'latest',
    );

    expect(
      groupHistoryBrowserEntries(latest).map((group) => ({
        cwd: group.cwd,
        entries: ids(group.entries),
      })),
    ).toEqual([
      { cwd: '/a/work', entries: ['a-new', 'a-old'] },
      { cwd: undefined, entries: ['no-cwd-new', 'no-cwd-old'] },
      { cwd: '/b/work', entries: ['b'] },
    ]);
  });
});
