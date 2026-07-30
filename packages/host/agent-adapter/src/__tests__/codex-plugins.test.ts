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
          install: false,
          uninstall: false,
          update: false,
          enable: false,
          disable: false,
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

  it('honestly reports no plugin toggle support', () => {
    const adapter: PluginProviderAdapter = new CodexPluginAdapter(() =>
      Promise.reject(new Error('not used')),
    );

    expect('setPluginEnabled' in adapter).toBe(false);
  });
});
