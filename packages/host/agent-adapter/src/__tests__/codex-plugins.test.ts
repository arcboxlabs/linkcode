import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginProviderAdapter } from '../plugins/adapter';
import type { CodexPluginServer, StartCodexPluginServer } from '../plugins/codex';
import { CodexPluginAdapter } from '../plugins/codex';

function codexInterface(displayName: string) {
  return {
    displayName,
    shortDescription: 'Compile LaTeX documents',
    longDescription: null,
    developerName: 'LinkCode',
    category: 'documents',
    capabilities: ['skills', 'mcp'],
    websiteUrl: 'https://example.com/latex',
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CodexPluginAdapter', () => {
  it('maps local and remote marketplaces through plugin/list and plugin/read', async () => {
    const request = vi.fn((method: string, params: unknown) => {
      if (method === 'plugin/list') {
        return Promise.resolve({
          marketplaces: [
            {
              name: 'local-tools',
              path: '/marketplaces/local-tools',
              interface: { displayName: 'Local Tools' },
              plugins: [
                {
                  id: 'latex@local-tools',
                  remotePluginId: null,
                  version: '2.0.0',
                  localVersion: '1.9.0',
                  name: 'latex',
                  source: { type: 'local', path: '/plugins/latex' },
                  installed: true,
                  enabled: true,
                  availability: 'AVAILABLE',
                  interface: codexInterface('LaTeX'),
                  keywords: ['latex'],
                },
              ],
            },
            {
              name: 'cloud-tools',
              path: null,
              interface: null,
              plugins: [
                {
                  id: 'review@cloud-tools',
                  remotePluginId: 'remote-review-123',
                  version: '1.0.0',
                  localVersion: null,
                  name: 'review',
                  source: { type: 'remote' },
                  installed: false,
                  enabled: false,
                  availability: 'DISABLED_BY_ADMIN',
                  interface: {
                    ...codexInterface('Review'),
                    websiteUrl: 'not-a-url',
                  },
                  keywords: [],
                },
              ],
            },
          ],
        });
      }
      const pluginName =
        typeof params === 'object' && params !== null && 'pluginName' in params
          ? params.pluginName
          : undefined;
      if (pluginName === 'latex') {
        return Promise.resolve({
          plugin: {
            description: 'Compile documents with Tectonic',
            skills: [
              {
                name: 'latex',
                description: 'Compile a document',
                enabled: true,
              },
            ],
            hooks: [{ key: 'render-complete', eventName: 'AfterTool' }],
            apps: [],
            appTemplates: [],
            mcpServers: ['documents'],
          },
        });
      }
      return Promise.reject(new Error('remote detail unavailable'));
    });
    const close = vi.fn();
    const server: CodexPluginServer = { request, close };
    const startServer: StartCodexPluginServer = () => Promise.resolve(server);

    const plugins = await new CodexPluginAdapter(startServer).list({ cwd: '/workspace/demo' });

    expect(plugins).toEqual([
      expect.objectContaining({
        provider: 'codex',
        id: 'latex@local-tools',
        displayName: 'LaTeX',
        description: 'Compile documents with Tectonic',
        author: { name: 'LinkCode' },
        marketplace: {
          name: 'local-tools',
          displayName: 'Local Tools',
          path: '/marketplaces/local-tools',
        },
        source: { type: 'local', path: '/plugins/latex' },
        installations: [
          {
            enabled: true,
            version: '1.9.0',
            path: '/plugins/latex',
          },
        ],
        components: [
          { kind: 'hook', name: 'render-complete', description: 'AfterTool' },
          { kind: 'mcp-server', name: 'documents' },
          {
            kind: 'skill',
            name: 'latex',
            description: 'Compile a document',
            enabled: true,
          },
        ],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: false,
          enable: true,
          disable: true,
        },
      }),
      expect.objectContaining({
        id: 'review@cloud-tools',
        displayName: 'Review',
        description: 'Compile LaTeX documents',
        availability: 'blocked',
        installations: [],
        source: { type: 'remote' },
        components: [],
      }),
    ]);
    expect(request).toHaveBeenCalledWith('plugin/list', { cwds: ['/workspace/demo'] });
    expect(request).toHaveBeenCalledWith('plugin/read', {
      pluginName: 'latex',
      marketplacePath: '/marketplaces/local-tools',
    });
    expect(request).toHaveBeenCalledWith('plugin/read', {
      pluginName: 'remote-review-123',
      remoteMarketplaceName: 'cloud-tools',
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('accepts a marketplace plugin whose optional keys are absent', async () => {
    // codex 0.144.1 omits `version` entirely rather than sending null (CODE-505).
    const request = vi.fn(() =>
      Promise.resolve({
        marketplaces: [
          {
            name: 'openai-bundled',
            plugins: [
              {
                id: 'search@openai-bundled',
                name: 'search',
                source: { type: 'remote' },
                installed: true,
                enabled: true,
                availability: 'AVAILABLE',
                keywords: [],
              },
            ],
          },
        ],
      }),
    );
    const server: CodexPluginServer = { request, close: vi.fn() };

    const plugins = await new CodexPluginAdapter(() => Promise.resolve(server)).list();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({ id: 'search@openai-bundled', version: undefined });
  });

  it('collapses a duplicated catalog id onto its installed copy', async () => {
    // The live remote catalog listed `metabase` twice; ids are the model's identity.
    const entry = (installed: boolean, version: string) => ({
      id: 'metabase@openai-curated-remote',
      remotePluginId: 'remote-metabase',
      name: 'metabase',
      localVersion: installed ? version : null,
      source: { type: 'remote' },
      installed,
      enabled: installed,
      availability: 'AVAILABLE',
      keywords: [],
    });
    const request = vi.fn((method: string) =>
      method === 'plugin/list'
        ? Promise.resolve({
            marketplaces: [
              { name: 'openai-curated-remote', plugins: [entry(false, '1.0.0')] },
              { name: 'openai-curated-remote', plugins: [entry(true, '2.0.0')] },
            ],
          })
        : Promise.reject(new Error('no detail')),
    );

    const plugins = await new CodexPluginAdapter(() =>
      Promise.resolve({ request, close: vi.fn() }),
    ).list();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].installations).toEqual([{ enabled: true, version: '2.0.0' }]);
  });

  it('closes the app-server when provider output is malformed', async () => {
    const close = vi.fn();
    const server: CodexPluginServer = {
      request: () => Promise.resolve({ marketplaces: 'invalid' }),
      close,
    };

    await expect(new CodexPluginAdapter(() => Promise.resolve(server)).list()).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the app-server when plugin discovery exceeds its deadline', async () => {
    vi.useFakeTimers();
    let rejectRequest: (reason?: unknown) => void = noop;
    const request = vi.fn(
      () =>
        new Promise<unknown>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const close = vi.fn(() => rejectRequest(new Error('app-server closed')));
    const server: CodexPluginServer = { request, close };

    const discovery = new CodexPluginAdapter(() => Promise.resolve(server)).list();
    const rejection = expect(discovery).rejects.toThrow('app-server closed');
    await vi.advanceTimersByTimeAsync(30000);

    await rejection;
    expect(close).toHaveBeenCalledOnce();
  });

  it('applies the discovery deadline while the app-server is starting', async () => {
    vi.useFakeTimers();
    const startServer: StartCodexPluginServer = (signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new Error('codex: plugin discovery timed out')),
          { once: true },
        );
      });

    const discovery = new CodexPluginAdapter(startServer).list();
    const rejection = expect(discovery).rejects.toThrow('plugin discovery timed out');
    await vi.advanceTimersByTimeAsync(30000);

    await rejection;
  });

  it('lists bare-named skills as standalone and filters plugin-qualified ones', async () => {
    const close = vi.fn();
    const request = vi.fn((method: string, params: unknown) => {
      expect(method).toBe('skills/list');
      expect(params).toEqual({ cwds: ['/workspace'], forceReload: false });
      return Promise.resolve({
        data: [
          {
            cwd: '/workspace',
            skills: [
              {
                name: 'linear',
                description: 'Linear workflow',
                path: '/workspace/.agents/skills/linear/SKILL.md',
                scope: 'repo',
                enabled: true,
              },
              {
                name: 'browser:control-in-app-browser',
                description: 'Bundled plugin skill',
                path: '/home/user/.codex/plugins/cache/browser/skills/control/SKILL.md',
                scope: 'user',
                enabled: true,
              },
              {
                name: 'better-skill-creator',
                description: '',
                path: '/home/user/skills/better-skill-creator/SKILL.md',
                scope: 'user',
                enabled: true,
              },
              { malformed: true },
            ],
          },
          {
            skills: [
              {
                name: 'better-skill-creator',
                description: 'duplicate path entry',
                path: '/home/user/skills/better-skill-creator/SKILL.md',
                scope: 'user',
                enabled: true,
              },
            ],
          },
        ],
      });
    });
    const server: CodexPluginServer = { request, close };

    const skills = await new CodexPluginAdapter(() => Promise.resolve(server)).listStandaloneSkills(
      { cwd: '/workspace' },
    );

    expect(skills).toEqual([
      {
        provider: 'codex',
        id: 'better-skill-creator',
        name: 'better-skill-creator',
        description: undefined,
        scope: 'user',
        path: '/home/user/skills/better-skill-creator/SKILL.md',
        enabled: true,
        toggleable: true,
      },
      {
        provider: 'codex',
        id: 'linear',
        name: 'linear',
        description: 'Linear workflow',
        scope: 'project',
        path: '/workspace/.agents/skills/linear/SKILL.md',
        enabled: true,
        toggleable: true,
      },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it('writes per-skill enablement by SKILL.md path', async () => {
    const close = vi.fn();
    const request = vi.fn(() => Promise.resolve({ effectiveEnabled: false }));
    const server: CodexPluginServer = { request, close };

    await new CodexPluginAdapter(() => Promise.resolve(server)).setSkillEnabled(
      { id: 'linear', path: '/workspace/.agents/skills/linear/SKILL.md', scope: 'project' },
      false,
    );

    expect(request).toHaveBeenCalledWith('skills/config/write', {
      path: '/workspace/.agents/skills/linear/SKILL.md',
      enabled: false,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('toggles a plugin through the quoted config key path of its installed entry', async () => {
    const request = vi.fn((method: string) =>
      method === 'plugin/installed'
        ? Promise.resolve({
            marketplaces: [
              {
                name: 'openai-bundled',
                plugins: [
                  {
                    id: 'visualize@openai-bundled',
                    name: 'visualize',
                    source: { type: 'remote' },
                    installed: true,
                    enabled: true,
                    availability: 'AVAILABLE',
                    keywords: [],
                  },
                ],
              },
            ],
          })
        : Promise.resolve({ status: 'ok' }),
    );
    const server: CodexPluginServer = { request, close: vi.fn() };

    await new CodexPluginAdapter(() => Promise.resolve(server)).setPluginEnabled(
      'visualize@openai-bundled',
      false,
      { cwd: '/workspace' },
    );

    expect(request).toHaveBeenCalledWith('plugin/installed', { cwds: ['/workspace'] });
    expect(request).toHaveBeenCalledWith('config/value/write', {
      keyPath: 'plugins."visualize@openai-bundled".enabled',
      value: false,
      mergeStrategy: 'upsert',
    });
  });

  it('rejects a toggle for a plugin the host has not installed', async () => {
    const request = vi.fn(() => Promise.resolve({ marketplaces: [] }));
    const close = vi.fn();

    await expect(
      new CodexPluginAdapter(() => Promise.resolve({ request, close })).setPluginEnabled(
        'ghost@openai-bundled',
        false,
      ),
    ).rejects.toThrow('does not list a plugin ghost@openai-bundled');
    // No blind config write: nothing is appended to config.toml for an id that isn't installed.
    expect(request).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it('installs a remote plugin by marketplace name and reports apps still needing auth', async () => {
    const request = vi.fn((method: string) =>
      method === 'plugin/list'
        ? Promise.resolve({
            marketplaces: [
              {
                name: 'openai-curated-remote',
                path: null,
                plugins: [
                  {
                    id: 'github@openai-curated-remote',
                    remotePluginId: 'remote-github-1',
                    name: 'github',
                    source: { type: 'remote' },
                    installed: false,
                    enabled: false,
                    availability: 'AVAILABLE',
                    keywords: [],
                  },
                ],
              },
            ],
          })
        : Promise.resolve({
            authPolicy: 'ON_INSTALL',
            appsNeedingAuth: [{ id: 'connector_768', name: 'GitHub' }],
          }),
    );
    const server: CodexPluginServer = { request, close: vi.fn() };

    const outcome = await new CodexPluginAdapter(() => Promise.resolve(server)).installPlugin(
      'github@openai-curated-remote',
    );

    expect(request).toHaveBeenCalledWith('plugin/install', {
      pluginName: 'remote-github-1',
      remoteMarketplaceName: 'openai-curated-remote',
    });
    expect(outcome).toEqual({ pendingAuthApps: ['GitHub'] });
  });

  it('installs a local-marketplace plugin by path and local name', async () => {
    const request = vi.fn((method: string) =>
      method === 'plugin/list'
        ? Promise.resolve({
            marketplaces: [
              {
                name: 'openai-bundled',
                path: '/marketplaces/openai-bundled/marketplace.json',
                plugins: [
                  {
                    id: 'chrome@openai-bundled',
                    name: 'chrome',
                    source: { type: 'local', path: '/plugins/chrome' },
                    installed: false,
                    enabled: false,
                    availability: 'AVAILABLE',
                    keywords: [],
                  },
                ],
              },
            ],
          })
        : Promise.resolve({ authPolicy: 'ON_USE', appsNeedingAuth: [] }),
    );

    const outcome = await new CodexPluginAdapter(() =>
      Promise.resolve({ request, close: vi.fn() }),
    ).installPlugin('chrome@openai-bundled');

    expect(request).toHaveBeenCalledWith('plugin/install', {
      pluginName: 'chrome',
      marketplacePath: '/marketplaces/openai-bundled/marketplace.json',
    });
    expect(outcome).toEqual({ pendingAuthApps: [] });
  });

  it('uninstalls by plugin id without a catalog lookup', async () => {
    const request = vi.fn(() => Promise.resolve({}));
    const close = vi.fn();
    const adapter: PluginProviderAdapter = new CodexPluginAdapter(() =>
      Promise.resolve({ request, close }),
    );

    await adapter.uninstallPlugin?.('chrome@openai-bundled');

    expect(request).toHaveBeenCalledExactlyOnceWith('plugin/uninstall', {
      pluginId: 'chrome@openai-bundled',
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
