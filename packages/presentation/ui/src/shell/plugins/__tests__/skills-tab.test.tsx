// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillsTab } from '../skills-tab';
import type { SkillRowView } from '../types';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

function bundledSkill(enabled: boolean): SkillRowView {
  return {
    key: `codex:plugin:skill:${enabled}`,
    provider: 'codex',
    skillId: 'review',
    path: '',
    pluginKey: 'codex:plugin',
    pluginTitle: 'Plugin',
    name: 'Review',
    description: undefined,
    enabled,
    canToggle: false,
    standaloneScope: undefined,
    searchText: 'review',
  };
}

describe('SkillsTab', () => {
  it('shows bundled skill state without exposing a mutation switch', () => {
    render(
      <SkillsTab
        rows={[bundledSkill(true), bundledSkill(false)]}
        busy={false}
        searchQuery=""
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('enabledReadOnly')).toBeTruthy();
    expect(screen.getByText('disabledReadOnly')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
