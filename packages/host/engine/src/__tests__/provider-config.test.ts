import type { Account, ProvidersConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { accountBinding, applyProviderDefaults } from '../agent/provider-config';

const baseOpts: StartOptions = { kind: 'codex', cwd: '/repo' };

describe('applyProviderDefaults', () => {
  it('returns the input untouched when no config exists for the kind', () => {
    const providers: ProvidersConfig = { 'claude-code': { enabled: true, apiKey: 'sk-x' } };
    expect(applyProviderDefaults(baseOpts, providers).options).toBe(baseOpts);
  });

  it('fills the default model only when the client did not specify one', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, defaultModel: 'o4-mini' } };
    expect(applyProviderDefaults(baseOpts, providers).options.model).toBe('o4-mini');
    expect(applyProviderDefaults({ ...baseOpts, model: 'gpt-4o' }, providers).options.model).toBe(
      'gpt-4o',
    );
    expect(applyProviderDefaults({ ...baseOpts, model: null }, providers).options.model).toBeNull();
  });

  it('injects the api key into config, preserving existing config keys', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, apiKey: 'sk-live' } };
    const merged = applyProviderDefaults({ ...baseOpts, config: { tools: ['a'] } }, providers);
    expect(merged.options.config).toEqual({ tools: ['a'], apiKey: 'sk-live' });
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
    expect(applyProviderDefaults(baseOpts, providers, [account]).options.config).toEqual({
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
    expect(merged.options.config).toMatchObject({ apiKey: 'sk-other' });
  });

  it('injects authToken, baseUrl and protocol for an auth-token account with an endpoint', () => {
    const gateway: Account = {
      id: 'gw',
      label: 'Relay',
      credential: { type: 'auth-token', token: 'or-tok' },
      endpoint: { baseUrl: 'https://relay.example.com/v1', protocol: 'openai-responses' },
      createdAt: 0,
    };
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'gw' } };
    const merged = applyProviderDefaults(baseOpts, providers, [gateway]);
    expect(merged.options.config).toEqual({
      authToken: 'or-tok',
      baseUrl: 'https://relay.example.com/v1',
      protocol: 'openai-responses',
    });
  });

  it('reports an account whose endpoint the agent cannot speak instead of injecting it', () => {
    const anthropicOnly: Account = {
      id: 'gw',
      label: 'OpenRouter',
      credential: { type: 'auth-token', token: 'or-tok' },
      endpoint: { baseUrl: 'https://openrouter.ai/api', protocol: 'anthropic' },
      createdAt: 0,
    };
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'gw' } };
    const merged = applyProviderDefaults(baseOpts, providers, [anthropicOnly]);
    expect(merged.unavailable).toBe('protocol-unsupported');
    expect(merged.options.config?.baseUrl).toBeUndefined();
  });

  it('resolves a catalog service to the endpoint the bound agent speaks', () => {
    const openai: Account = {
      id: 'oa',
      label: 'OpenAI',
      service: 'openai-api',
      credential: { type: 'api-key', key: 'sk-oa' },
      createdAt: 0,
    };
    const providers: ProvidersConfig = { codex: { enabled: true, activeAccountId: 'oa' } };
    // Codex overrides the base URL of its own Responses provider, so it carries no knownProvider.
    expect(applyProviderDefaults(baseOpts, providers, [openai]).options.config).toEqual({
      apiKey: 'sk-oa',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'openai-responses',
    });
    const forOpencode = applyProviderDefaults(
      { ...baseOpts, kind: 'opencode' },
      { opencode: { enabled: true, activeAccountId: 'oa' } },
      [openai],
    );
    expect(forOpencode.options.config).toMatchObject({ knownProvider: 'openai' });
  });

  it('prefers the account model over the provider default model', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, defaultModel: 'o4-mini', activeAccountId: 'acc_1' },
    };
    expect(
      applyProviderDefaults(baseOpts, providers, [{ ...account, model: 'gpt-5' }]).options.model,
    ).toBe('gpt-5');
  });

  it('falls back to the legacy apiKey when the bound account id is stale', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, apiKey: 'sk-legacy', activeAccountId: 'deleted' },
    };
    expect(applyProviderDefaults(baseOpts, providers, [account]).options.config).toEqual({
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
    expect(applyProviderDefaults(baseOpts, providers, [oauth]).options.config).toEqual({});
  });
});

describe('accountBinding', () => {
  const account: Account = {
    id: 'acc_1',
    label: 'Relay',
    credential: { type: 'api-key', key: 'sk-new' },
    createdAt: 1,
  };

  it('preserves unrelated providers and accounts while binding the selected agent', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, defaultModel: 'gpt-5' },
      opencode: { enabled: false, activeAccountId: 'acc_2' },
    };
    const other: Account = {
      id: 'acc_2',
      label: 'Other',
      credential: { type: 'api-key', key: 'sk-other' },
      createdAt: 0,
    };

    expect(accountBinding(providers, [other], 'codex', account)).toEqual({
      providers: {
        codex: { enabled: true, defaultModel: 'gpt-5', activeAccountId: 'acc_1' },
        opencode: { enabled: false, activeAccountId: 'acc_2' },
      },
      accounts: [other, account],
    });
  });

  it('upserts by account id so retrying the same request is idempotent', () => {
    const first = accountBinding({}, [], 'codex', account);
    const updated = { ...account, label: 'Updated relay' };
    const retry = accountBinding(first.providers, first.accounts, 'codex', updated);

    expect(retry.accounts).toEqual([updated]);
    expect(retry.providers.codex?.activeAccountId).toBe(account.id);
  });
});
