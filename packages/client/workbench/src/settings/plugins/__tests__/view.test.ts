import type { PluginList } from '@linkcode/client-core';
import type { Plugin } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  filterPluginCards,
  pluginCardView,
  pluginMcpServerRows,
  pluginProviderGroups,
  skillRows,
} from '../view';

function plugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    provider: 'claude-code',
    id: 'latex@team-tools',
    name: 'latex',
    displayName: 'LaTeX Toolkit',
    description: 'Compile LaTeX documents.',
    version: '2.0.0',
    keywords: ['latex'],
    marketplace: { name: 'team-tools', displayName: 'Team Tools' },
    availability: 'available',
    installations: [{ enabled: true, version: '1.2.3', scope: 'user' }],
    components: [
      { kind: 'skill', name: 'compile-latex', description: 'Compile to PDF' },
      { kind: 'skill', name: 'bibtex-cleanup' },
      { kind: 'mcp-server', name: 'latex-tools' },
    ],
    assets: [],
    managementCapabilities: {
      install: false,
      uninstall: false,
      update: false,
      enable: true,
      disable: true,
    },
    ...overrides,
  };
}

function list(overrides: Partial<PluginList> = {}): PluginList {
  return {
    plugins: [plugin()],
    standaloneSkills: [],
    providerStatus: [
      { provider: 'claude-code', ok: true },
      { provider: 'codex', ok: false, reason: 'binary not found' },
    ],
    ...overrides,
  };
}

describe('pluginCardView', () => {
  it('derives title, install state, capability gating, and component counts', () => {
    const card = pluginCardView(plugin());

    expect(card).toMatchObject({
      key: 'claude-code:latex@team-tools',
      title: 'LaTeX Toolkit',
      version: '1.2.3',
      marketplaceLabel: 'Team Tools',
      installed: true,
      installations: [{ scope: 'user', enabled: true, canToggle: true }],
      componentCounts: { skill: 2, 'mcp-server': 1 },
    });
  });

  it('gates the toggle off when the provider reports no management capability', () => {
    const card = pluginCardView(
      plugin({
        provider: 'codex',
        managementCapabilities: {
          install: false,
          uninstall: false,
          update: false,
          enable: false,
          disable: false,
        },
      }),
    );

    expect(card.installations[0].canToggle).toBe(false);
  });
});

describe('pluginProviderGroups', () => {
  it('keeps failed discovery distinguishable from an empty catalog', () => {
    const groups = pluginProviderGroups(list());

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ provider: 'claude-code', discoveryFailed: false });
    expect(groups[0].plugins).toHaveLength(1);
    expect(groups[1]).toMatchObject({
      provider: 'codex',
      discoveryFailed: true,
      failureReason: 'binary not found',
      plugins: [],
    });
  });
});

describe('filterPluginCards', () => {
  it('matches id, title, description, keywords, and component names', () => {
    const cards = [pluginCardView(plugin())];

    expect(filterPluginCards(cards, 'bibtex')).toHaveLength(1);
    expect(filterPluginCards(cards, 'TOOLKIT')).toHaveLength(1);
    expect(filterPluginCards(cards, 'nonexistent')).toHaveLength(0);
    expect(filterPluginCards(cards, '  ')).toHaveLength(1);
  });
});

describe('skillRows', () => {
  it('groups plugin skills with sibling counts and appends standalone skills', () => {
    const rows = skillRows(
      list({
        standaloneSkills: [
          {
            provider: 'codex',
            id: 'linear',
            name: 'linear',
            scope: 'project',
            path: '/x',
            toggleable: false,
          },
        ],
      }),
    );

    expect(rows.map((row) => row.name)).toEqual(['compile-latex', 'bibtex-cleanup', 'linear']);
    expect(rows[0]).toMatchObject({
      pluginTitle: 'LaTeX Toolkit',
      canToggle: true,
      siblingSkillCount: 2,
      standaloneScope: undefined,
    });
    expect(rows[2]).toMatchObject({
      pluginKey: undefined,
      canToggle: false,
      standaloneScope: 'project',
    });
  });

  it('excludes skills from plugins that are not installed', () => {
    const rows = skillRows(list({ plugins: [plugin({ installations: [] })] }));

    expect(rows).toEqual([]);
  });
});

describe('pluginMcpServerRows', () => {
  it('projects installed plugins’ mcp-server components read-only', () => {
    const rows = pluginMcpServerRows([plugin(), plugin({ id: 'x@y', installations: [] })]);

    expect(rows).toEqual([
      {
        key: 'claude-code:latex@team-tools:latex-tools',
        provider: 'claude-code',
        pluginTitle: 'LaTeX Toolkit',
        serverName: 'latex-tools',
        enabled: true,
      },
    ]);
  });
});
