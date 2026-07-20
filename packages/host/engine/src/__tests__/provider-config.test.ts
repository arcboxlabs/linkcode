import type { Account, ProvidersConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { applyProviderDefaults, withBoundAccountModels } from '../agent/provider-config';

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

describe('withBoundAccountModels', () => {
  const catalog = {
    models: [{ id: 'openai/gpt-test', label: 'GPT Test' }],
    policies: [],
  };
  const account: Account = {
    id: 'acc_banned',
    label: 'Banned',
    credential: { type: 'api-key', key: 'gwen' },
    endpoint: { baseUrl: 'https://banned.test/v1', protocol: 'openai-chat' },
    customProvider: {
      name: 'banned',
      models: [
        {
          id: '@cf/glm',
          name: 'GLM',
          reasoning: true,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 16384,
          thinkingLevelMap: { xhigh: 'xhigh' },
        },
        {
          id: '@cf/kimi',
          name: 'Kimi',
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 16384,
        },
      ],
    },
    createdAt: 0,
  };

  it('appends the bound account custom models with mapped effort levels', () => {
    const enriched = withBoundAccountModels(
      catalog,
      { enabled: true, activeAccountId: 'acc_banned' },
      [account],
    );
    expect(enriched.models.map((m) => m.id)).toEqual([
      'openai/gpt-test',
      'banned/@cf/glm',
      'banned/@cf/kimi',
    ]);
    expect(enriched.models[1].effortLevels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(enriched.models[2].effortLevels).toEqual([]);
  });

  it('returns the catalog unchanged when no account is bound or it defines no provider', () => {
    expect(withBoundAccountModels(catalog, undefined, [account])).toBe(catalog);
    expect(
      withBoundAccountModels(catalog, { enabled: true, activeAccountId: 'missing' }, [account]),
    ).toBe(catalog);
  });

  it('lets existing catalog entries win on id collisions', () => {
    const colliding = { models: [{ id: 'banned/@cf/glm', label: 'live' }], policies: [] };
    const enriched = withBoundAccountModels(
      colliding,
      { enabled: true, activeAccountId: 'acc_banned' },
      [account],
    );
    expect(enriched.models.map((m) => m.label)).toEqual(['live', 'Kimi']);
  });
});
