import type { Account, PluginConfig, ProvidersConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  applyPluginConfigSet,
  applyProviderDefaults,
  publicPluginConfig,
} from '../agent/provider-config';

const baseOpts: StartOptions = { kind: 'codex', cwd: '/repo' };

describe('applyProviderDefaults', () => {
  it('returns the input untouched when no config exists for the kind', () => {
    const providers: ProvidersConfig = { 'claude-code': { enabled: true, apiKey: 'sk-x' } };
    expect(applyProviderDefaults(baseOpts, providers)).toBe(baseOpts);
  });

  it('fills the default model only when the client did not specify one', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, defaultModel: 'o4-mini' } };
    expect(applyProviderDefaults(baseOpts, providers).model).toBe('o4-mini');
    expect(applyProviderDefaults({ ...baseOpts, model: 'gpt-4o' }, providers).model).toBe('gpt-4o');
    expect(applyProviderDefaults({ ...baseOpts, model: null }, providers).model).toBeNull();
  });

  it('injects the api key into config, preserving existing config keys', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, apiKey: 'sk-live' } };
    const merged = applyProviderDefaults({ ...baseOpts, config: { tools: ['a'] } }, providers);
    expect(merged.config).toEqual({ tools: ['a'], apiKey: 'sk-live' });
  });

  it('does not mutate the input options', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, defaultModel: 'o4-mini', apiKey: 'sk' },
    };
    const opts: StartOptions = { kind: 'codex', cwd: '/repo' };
    applyProviderDefaults(opts, providers);
    expect(opts).toEqual({ kind: 'codex', cwd: '/repo' });
  });
});

describe('applyProviderDefaults account pool', () => {
  const account: Account = {
    id: 'acc_1',
    label: 'Personal',
    credential: { type: 'api-key', key: 'sk-acc' },
    createdAt: 0,
  };

  it('injects the credential from the account bound via activeAccountId', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'acc_1' } };
    expect(applyProviderDefaults(baseOpts, providers, [account]).config).toEqual({
      apiKey: 'sk-acc',
    });
  });

  it('lets an explicit opts.config.accountId override activeAccountId', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'acc_1' } };
    const other: Account = {
      id: 'acc_2',
      label: 'Other',
      credential: { type: 'api-key', key: 'sk-other' },
      createdAt: 0,
    };
    const merged = applyProviderDefaults(
      { ...baseOpts, config: { accountId: 'acc_2' } },
      providers,
      [account, other],
    );
    expect(merged.config).toMatchObject({ apiKey: 'sk-other' });
  });

  it('injects authToken, baseUrl and protocol for an auth-token account with an endpoint', () => {
    const gateway: Account = {
      id: 'gw',
      label: 'OpenRouter',
      credential: { type: 'auth-token', token: 'or-tok' },
      endpoint: { baseUrl: 'https://openrouter.ai/api', protocol: 'anthropic' },
      createdAt: 0,
    };
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'gw' } };
    const merged = applyProviderDefaults(baseOpts, providers, [gateway]);
    expect(merged.config).toEqual({
      authToken: 'or-tok',
      baseUrl: 'https://openrouter.ai/api',
      protocol: 'anthropic',
    });
  });

  it('prefers the account model over the provider default model', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, defaultModel: 'o4-mini', activeAccountId: 'acc_1' },
    };
    expect(applyProviderDefaults(baseOpts, providers, [{ ...account, model: 'gpt-5' }]).model).toBe(
      'gpt-5',
    );
  });

  it('falls back to the legacy apiKey when the bound account id is stale', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, apiKey: 'sk-legacy', activeAccountId: 'deleted' },
    };
    expect(applyProviderDefaults(baseOpts, providers, [account]).config).toEqual({
      apiKey: 'sk-legacy',
    });
  });

  it('injects no secret for an oauth account', () => {
    const oauth: Account = {
      id: 'oauth_1',
      label: 'CLI login',
      credential: { type: 'oauth', agent: 'codex' },
      createdAt: 0,
    };
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'oauth_1' } };
    expect(applyProviderDefaults(baseOpts, providers, [oauth]).config).toEqual({});
  });
});

describe('plugin config', () => {
  const config: PluginConfig = {
    units: [{ unitId: 'github-read', enabled: true }],
    serviceBindings: { github: { type: 'local', connectorId: 'github-personal' } },
    connectors: [
      {
        id: 'github-personal',
        label: 'Personal',
        service: 'github',
        credential: { type: 'auth-token', secret: 'old-secret' },
      },
    ],
    customServers: [],
  };

  it('returns credential metadata without exposing a secret or a reusable mask', () => {
    const publicConfig = publicPluginConfig(config);
    expect(publicConfig.connectors[0]?.credential).toEqual({
      type: 'auth-token',
      configured: true,
    });
    expect(JSON.stringify(publicConfig)).not.toContain('old-secret');
  });

  it('keeps an omitted credential and replaces an explicitly supplied credential', () => {
    const kept = applyPluginConfigSet(config, {
      connectorOperations: [{ type: 'update', connectorId: 'github-personal', label: 'Renamed' }],
    });
    expect(kept.connectors[0]?.credential.secret).toBe('old-secret');

    const replaced = applyPluginConfigSet(kept, {
      connectorOperations: [
        {
          type: 'update',
          connectorId: 'github-personal',
          credential: { type: 'auth-token', secret: 'new-secret' },
        },
      ],
    });
    expect(replaced.connectors[0]?.credential.secret).toBe('new-secret');
  });

  it('deletes a connector and atomically drops every service binding that referenced it', () => {
    expect(
      applyPluginConfigSet(config, {
        connectorOperations: [{ type: 'delete', connectorId: 'github-personal' }],
      }),
    ).toEqual({
      units: [{ unitId: 'github-read', enabled: true }],
      serviceBindings: {},
      connectors: [],
      customServers: [],
    });
  });

  it('adds, toggles, replaces, and removes a custom server without a connector', () => {
    const added = applyPluginConfigSet(config, {
      customServerOperations: [
        {
          type: 'add',
          server: {
            id: 'cs1',
            enabled: true,
            server: {
              type: 'stdio',
              name: 'local-fs',
              command: 'fs-mcp',
              env: { TOKEN: 'sekret' },
            },
          },
        },
      ],
    });
    expect(added.customServers).toHaveLength(1);

    // An update without a `server` preserves the stored one (including its inline secret).
    const toggled = applyPluginConfigSet(added, {
      customServerOperations: [{ type: 'update', id: 'cs1', enabled: false }],
    });
    expect(toggled.customServers[0]).toMatchObject({
      enabled: false,
      server: { env: { TOKEN: 'sekret' } },
    });

    const removed = applyPluginConfigSet(toggled, {
      customServerOperations: [{ type: 'remove', id: 'cs1' }],
    });
    expect(removed.customServers).toEqual([]);
  });

  it('rejects a custom server name that collides with a catalog server', () => {
    expect(() =>
      applyPluginConfigSet(config, {
        customServerOperations: [
          {
            type: 'add',
            server: {
              id: 'cs-dupe',
              enabled: true,
              server: { type: 'stdio', name: 'linkcode-github', command: 'x' },
            },
          },
        ],
      }),
    ).toThrow('built-in server');
  });

  it('masks custom server env and header values as key lists', () => {
    const withCustom = applyPluginConfigSet(config, {
      customServerOperations: [
        {
          type: 'add',
          server: {
            id: 'cs1',
            enabled: true,
            server: {
              type: 'http',
              name: 'remote-mcp',
              url: 'https://mcp.test',
              headers: { Authorization: 'Bearer sekret' },
            },
          },
        },
      ],
    });
    const publicConfig = publicPluginConfig(withCustom);
    expect(publicConfig.customServers[0]).toEqual({
      id: 'cs1',
      enabled: true,
      server: {
        type: 'http',
        name: 'remote-mcp',
        url: 'https://mcp.test',
        headerKeys: ['Authorization'],
      },
    });
    expect(JSON.stringify(publicConfig)).not.toContain('sekret');
  });
});
