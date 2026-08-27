import type { PluginList, PluginMarketReleaseEntry } from '@linkcode/client-core';
import type { Plugin } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  filterLinkCodeCatalogCards,
  filterPluginCards,
  linkcodeCatalogCards,
  linkcodeInstalledRow,
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

function catalogEntry(version: string): PluginMarketReleaseEntry {
  return {
    pluginId: 'linkcode/mail',
    release: {
      manifest: {
        manifestVersion: 1,
        id: 'linkcode/mail',
        version,
        displayName: 'Mail (163 / QQ)',
        description: 'Receive and send mail.',
        keywords: ['mail'],
        components: [
          { kind: 'mcp-server', name: 'mail', command: 'npx', env: { MAIL_USER: 'account' } },
        ],
        settings: { account: { type: 'string', required: true } },
        assets: [],
      },
      artifact: {
        urls: [`plugins/mail-${version}.tgz`],
        integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        format: 'tgz',
      },
    },
  };
}

describe('linkcodeCatalogCards', () => {
  it('projects a marketplace release entry to a catalog card with install state', () => {
    const [card] = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.0.0')],
      new Map([['linkcode/mail', '1.0.0']]),
    );

    expect(card).toMatchObject({
      key: 'linkcode-official:linkcode/mail',
      marketplaceId: 'linkcode-official',
      pluginId: 'linkcode/mail',
      version: '1.0.0',
      title: 'Mail (163 / QQ)',
      installed: true,
      updateAvailable: false,
      installedNewer: false,
    });
    expect(card.searchText).toContain('linkcode/mail');
  });

  it('distinguishes not-installed from an upgrade to an older installed version', () => {
    const [notInstalled] = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.0.0')],
      new Map(),
    );
    expect(notInstalled).toMatchObject({
      installed: false,
      updateAvailable: false,
      installedNewer: false,
    });

    const [upgrade] = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.0.0')],
      new Map([['linkcode/mail', '0.9.0']]),
    );
    expect(upgrade).toMatchObject({
      installed: false,
      updateAvailable: true,
      installedNewer: false,
    });
  });

  it('flags a newer-than-catalog install as neither installed nor an update', () => {
    const [card] = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.0.0')],
      new Map([['linkcode/mail', '1.1.0']]),
    );

    expect(card).toMatchObject({ installed: false, updateAvailable: false, installedNewer: true });
  });

  it('leaves a prerelease install switchable back to the stable release', () => {
    // The catalog prefers 1.9.0, so the installed beta reads as installedNewer — but the card must
    // stay actionable (`installed: false`) or there is no way off the prerelease.
    const [card] = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.9.0'), catalogEntry('2.0.0-beta.1')],
      new Map([['linkcode/mail', '2.0.0-beta.1']]),
    );

    expect(card).toMatchObject({
      version: '1.9.0',
      installed: false,
      updateAvailable: false,
      installedNewer: true,
    });
  });

  it('folds every published version of one plugin into a single card at the latest version', () => {
    // 0.10.0 outranks 0.9.0 numerically — a lexicographic compare would pick 0.9.0.
    const cards = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('0.9.0'), catalogEntry('0.10.0')],
      new Map(),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      pluginId: 'linkcode/mail',
      version: '0.10.0',
      installed: false,
      updateAvailable: false,
    });
  });

  it('lets a stable release outrank a higher prerelease', () => {
    const cards = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.9.0'), catalogEntry('2.0.0-beta.1')],
      new Map(),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ version: '1.9.0' });
  });

  it('still cards a plugin whose only releases are prereleases, at the newest one', () => {
    const cards = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('2.0.0-beta.1'), catalogEntry('2.0.0-beta.2')],
      new Map(),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ version: '2.0.0-beta.2' });
  });

  it('treats a hyphen in build metadata as stable, not as a prerelease', () => {
    const cards = linkcodeCatalogCards(
      'linkcode-official',
      [catalogEntry('1.9.0'), catalogEntry('2.0.0+build-7')],
      new Map(),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ version: '2.0.0+build-7' });
  });

  it('compares the installed version against the latest release, not just any release', () => {
    const releases = [catalogEntry('0.9.0'), catalogEntry('0.10.0')];

    const [behind] = linkcodeCatalogCards(
      'linkcode-official',
      releases,
      new Map([['linkcode/mail', '0.9.0']]),
    );
    expect(behind).toMatchObject({ version: '0.10.0', installed: false, updateAvailable: true });

    const [upToDate] = linkcodeCatalogCards(
      'linkcode-official',
      releases,
      new Map([['linkcode/mail', '0.10.0']]),
    );
    expect(upToDate).toMatchObject({ installed: true, updateAvailable: false });
  });
});

describe('linkcodeInstalledRow', () => {
  it('derives the title from the id and flags settings-bearing plugins', () => {
    expect(
      linkcodeInstalledRow({
        id: 'linkcode/mail',
        version: '1.0.0',
        settings: { account: { type: 'string' } },
        values: {},
        configuredSecrets: [],
      }),
    ).toEqual({
      key: 'linkcode/mail',
      pluginId: 'linkcode/mail',
      title: 'mail',
      version: '1.0.0',
      hasSettings: true,
    });
    expect(
      linkcodeInstalledRow({
        id: 'linkcode/notes',
        version: '0.2.0',
        settings: {},
        values: {},
        configuredSecrets: [],
      }).hasSettings,
    ).toBe(false);
  });
});

describe('filterLinkCodeCatalogCards', () => {
  it('filters by the precomputed haystack, blank query keeps all', () => {
    const cards = linkcodeCatalogCards(
      'linkcode-official',
      [
        {
          pluginId: 'linkcode/mail',
          release: {
            manifest: {
              manifestVersion: 1,
              id: 'linkcode/mail',
              version: '1.0.0',
              displayName: 'Mail',
              keywords: [],
              components: [{ kind: 'mcp-server', name: 'mail', command: 'npx' }],
              assets: [],
            },
            artifact: {
              urls: ['plugins/mail-1.0.0.tgz'],
              integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
              format: 'tgz',
            },
          },
        },
      ],
      new Map(),
    );
    expect(filterLinkCodeCatalogCards(cards, '')).toHaveLength(1);
    expect(filterLinkCodeCatalogCards(cards, 'mail')).toHaveLength(1);
    expect(filterLinkCodeCatalogCards(cards, 'zzz')).toHaveLength(0);
  });
});
