import type { SettingsSidebarNavGroup } from '@linkcode/ui';
import { describe, expect, it } from 'vitest';
import { filterSettingsNavGroups } from '../search';

function group(key: string, items: Array<{ key: string; label: string; keywords?: string[] }>) {
  return {
    key,
    label: key,
    items: items.map((item) => ({ ...item, icon: null })),
  } satisfies SettingsSidebarNavGroup;
}

const GROUPS = [
  group('personal', [
    { key: 'general', label: 'General', keywords: ['Language', 'Auto'] },
    { key: 'appearance', label: 'Appearance', keywords: ['Theme', 'Dark', 'Light'] },
    { key: 'notifications', label: 'Notifications', keywords: ['Turn completed'] },
  ]),
  group('integrations', [
    { key: 'agents', label: 'Agents', keywords: ['Enabled'] },
    { key: 'messaging', label: 'Messaging', keywords: ['Connect Telegram'] },
  ]),
];

function visibleKeys(groups: readonly SettingsSidebarNavGroup[]): string[][] {
  return groups.map((g) => g.items.map((item) => item.key));
}

describe('filterSettingsNavGroups', () => {
  it('returns every group untouched for an empty or whitespace query', () => {
    expect(visibleKeys(filterSettingsNavGroups(GROUPS, ''))).toEqual([
      ['general', 'appearance', 'notifications'],
      ['agents', 'messaging'],
    ]);
    expect(visibleKeys(filterSettingsNavGroups(GROUPS, '   '))).toEqual(
      visibleKeys(filterSettingsNavGroups(GROUPS, '')),
    );
  });

  it('matches item labels case-insensitively and empties the groups that miss', () => {
    expect(visibleKeys(filterSettingsNavGroups(GROUPS, 'appear'))).toEqual([['appearance'], []]);
  });

  it('matches field-level keywords, not just the tab label', () => {
    expect(visibleKeys(filterSettingsNavGroups(GROUPS, 'dark'))).toEqual([['appearance'], []]);
    expect(visibleKeys(filterSettingsNavGroups(GROUPS, 'telegram'))).toEqual([[], ['messaging']]);
  });

  it('preserves declaration order even when a later item scores higher', () => {
    // "general" matches General by prefix (80) and Agents by keyword (30); the label-scored
    // item would rank first, but sidebar display order must stay declaration order.
    const groups = [
      group('one', [
        { key: 'agents', label: 'Agents', keywords: ['general tools'] },
        { key: 'general', label: 'General' },
      ]),
    ];
    expect(visibleKeys(filterSettingsNavGroups(groups, 'general'))).toEqual([
      ['agents', 'general'],
    ]);
  });

  it('leaves every group empty when nothing matches', () => {
    expect(visibleKeys(filterSettingsNavGroups(GROUPS, 'zzz'))).toEqual([[], []]);
  });
});
