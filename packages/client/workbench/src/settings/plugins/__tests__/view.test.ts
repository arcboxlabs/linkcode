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

  it('allows install and toggles only when availability is available', () => {
    const card = pluginCardView(
      plugin({
        availability: 'blocked',
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: false,
          enable: true,
          disable: true,
        },
      }),
    );

    expect(card.canInstall).toBe(false);
    expect(card.canUninstall).toBe(true);
    expect(card.installations[0].canToggle).toBe(false);
  });

  it('does not offer Settings toggles for project or managed installations', () => {
    const card = pluginCardView(
      plugin({
        installations: [
          { enabled: true, scope: 'project' },
          { enabled: true, scope: 'managed' },
        ],
      }),
    );

    expect(card.installations.map((installation) => installation.canToggle)).toEqual([
      false,
      false,
    ]);
  });
});

describe('pluginProviderGroups', () => {
  it('keeps failed discovery distinguishable from an empty catalog', () => {
    const groups = pluginProviderGroups(list(), { installed: true });

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

describe('pluginProviderGroups partitioning', () => {
  it('separates installed plugins from uninstalled marketplace listings', () => {
    const catalog = list({
      plugins: [plugin(), plugin({ id: 'market-only@m', installations: [] })],
    });

    const installed = pluginProviderGroups(catalog, { installed: true });
    const market = pluginProviderGroups(catalog, { installed: false });

    expect(installed[0].plugins.map((card) => card.id)).toEqual(['latex@team-tools']);
    expect(market[0].plugins.map((card) => card.id)).toEqual(['market-only@m']);
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
            enabled: false,
            toggleable: true,
          },
        ],
      }),
    );

    expect(rows.map((row) => row.name)).toEqual(['compile-latex', 'bibtex-cleanup', 'linear']);
    expect(rows[0]).toMatchObject({
      pluginTitle: 'LaTeX Toolkit',
      canToggle: false,
      standaloneScope: undefined,
    });
    expect(rows[2]).toMatchObject({
      pluginKey: undefined,
      skillId: 'linear',
      path: '/x',
      // Standalone skills now carry the provider's own state and toggle individually.
      enabled: false,
      canToggle: true,
      standaloneScope: 'project',
    });
  });

  it('excludes skills from plugins that are not installed', () => {
    const rows = skillRows(list({ plugins: [plugin({ installations: [] })] }));

    expect(rows).toEqual([]);
  });

  it('keeps bundled skills read-only regardless of plugin installation mutability', () => {
    const mutable = skillRows(list());
    const multiScope = skillRows(
      list({
        plugins: [
          plugin({
            installations: [
              { enabled: true, scope: 'user' },
              { enabled: false, scope: 'project' },
            ],
          }),
        ],
      }),
    );
    const managed = skillRows(
      list({ plugins: [plugin({ installations: [{ enabled: true, scope: 'managed' }] })] }),
    );

    expect(mutable.every((row) => !row.canToggle)).toBe(true);
    expect(multiScope.every((row) => !row.canToggle)).toBe(true);
    expect(managed.every((row) => !row.canToggle)).toBe(true);
  });

  it('uses provider and exact path as a standalone skill identity', () => {
    const rows = skillRows(
      list({
        plugins: [],
        standaloneSkills: [
          {
            provider: 'claude-code',
            id: 'review',
            name: 'review',
            scope: 'user',
            path: '/home/user/.claude/skills/review',
            enabled: true,
            toggleable: true,
          },
          {
            provider: 'claude-code',
            id: 'review',
            name: 'review',
            scope: 'project',
            path: '/repo/.claude/skills/review',
            enabled: false,
            toggleable: true,
          },
        ],
      }),
    );

    expect(rows.map((row) => row.key)).toEqual([
      'claude-code:standalone:/home/user/.claude/skills/review',
      'claude-code:standalone:/repo/.claude/skills/review',
    ]);
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
