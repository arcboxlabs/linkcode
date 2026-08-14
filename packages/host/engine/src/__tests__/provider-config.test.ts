import type { Account, ProvidersConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { applyProviderDefaults } from '../agent/provider-config';

const baseOpts: StartOptions = { kind: 'codex', cwd: '/repo' };

describe('applyProviderDefaults', () => {
  it('returns the input untouched when nothing is configured for the kind', () => {
    const providers: ProvidersConfig = { 'claude-code': { enabled: true, apiKey: 'sk-x' } };
    expect(applyProviderDefaults(baseOpts, providers).options).toEqual(baseOpts);
  });

  it('injects the api key into config, preserving existing config keys', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, apiKey: 'sk-live' } };
    const merged = applyProviderDefaults({ ...baseOpts, config: { tools: ['a'] } }, providers);
    expect(merged.options.config).toEqual({ tools: ['a'], apiKey: 'sk-live' });
  });

  it('does not mutate the input options', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, apiKey: 'sk' } };
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

  it('injects the credential from the first account enabled for the agent', () => {
    const merged = applyProviderDefaults(baseOpts, {}, [account]);
    expect(merged.options.config).toEqual({ apiKey: 'sk-acc' });
    // Reported, not echoed into the adapter-facing config: the caller records what actually backed
    // the run, and nothing downstream can mistake a request for a resolution.
    expect(merged.accountId).toBe('acc_1');
  });

  it('takes the enabled list in pool order, and skips an account left out of it', () => {
    const other: Account = {
      ...account,
      id: 'acc_2',
      credential: { type: 'api-key', key: 'sk-2' },
    };
    // Pool order decides, not the order of `enabledAccountIds`.
    expect(
      applyProviderDefaults(baseOpts, { codex: { enabled: true, enabledAccountIds: ['acc_2'] } }, [
        account,
        other,
      ]).accountId,
    ).toBe('acc_2');
    expect(applyProviderDefaults(baseOpts, {}, [account, other]).accountId).toBe('acc_1');
    expect(
      applyProviderDefaults(baseOpts, { codex: { enabled: true, enabledAccountIds: [] } }, [
        account,
      ]).accountId,
    ).toBeUndefined();
  });

  it('lets an explicit opts.accountId outrank the first enabled one, and consumes it', () => {
    const other: Account = {
      id: 'acc_2',
      label: 'Other',
      credential: { type: 'api-key', key: 'sk-other' },
      createdAt: 0,
    };
    const merged = applyProviderDefaults({ ...baseOpts, accountId: 'acc_2' }, {}, [account, other]);
    expect(merged.options.config).toMatchObject({ apiKey: 'sk-other' });
    expect(merged.accountId).toBe('acc_2');
    expect(merged.options.accountId).toBeUndefined();
  });

  it('falls back to the first enabled account for a requested id that no longer resolves', () => {
    // A relaunch replays a pin recorded on the run, and that account can be deleted in between.
    const stale: StartOptions = { ...baseOpts, accountId: 'deleted' };
    const merged = applyProviderDefaults(stale, {}, [account]);
    expect(merged.accountId).toBe('acc_1');
    expect(merged.options.accountId).toBeUndefined();
    // With nothing enabled either, the request's own id must not survive as an account.
    const empty = applyProviderDefaults(
      stale,
      { codex: { enabled: true, enabledAccountIds: [] } },
      [account],
    );
    expect(empty.accountId).toBeUndefined();
    expect(empty.options.accountId).toBeUndefined();
  });

  it('injects authToken, baseUrl and protocol for an auth-token account with an endpoint', () => {
    const gateway: Account = {
      id: 'gw',
      label: 'Relay',
      credential: { type: 'auth-token', token: 'or-tok' },
      endpoint: { baseUrl: 'https://relay.example.com/v1', protocol: 'openai-responses' },
      createdAt: 0,
    };
    expect(applyProviderDefaults(baseOpts, {}, [gateway]).options.config).toEqual({
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
    // Named explicitly, so it resolves and then fails — an unusable account is never silently
    // skipped in favour of the next one.
    const merged = applyProviderDefaults({ ...baseOpts, accountId: 'gw' }, {}, [anthropicOnly]);
    expect(merged.unavailable).toBe('protocol-unsupported');
    expect(merged.options.config?.baseUrl).toBeUndefined();
  });

  it('resolves a catalog service to the endpoint the agent speaks', () => {
    const openai: Account = {
      id: 'oa',
      label: 'OpenAI',
      service: 'openai-api',
      credential: { type: 'api-key', key: 'sk-oa' },
      createdAt: 0,
    };
    // Codex overrides the base URL of its own Responses provider, so it carries no knownProvider.
    expect(applyProviderDefaults(baseOpts, {}, [openai]).options.config).toEqual({
      apiKey: 'sk-oa',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'openai-responses',
    });
    const forOpencode = applyProviderDefaults({ ...baseOpts, kind: 'opencode' }, {}, [openai]);
    expect(forOpencode.options.config).toMatchObject({ knownProvider: 'openai' });
  });

  it("fills the resolved account's first model, and never overrides the request's", () => {
    // Nothing stores an agent default: the head of the account's picked set is it, which is also
    // what the composer shows for an untouched draft.
    const picked = { ...account, models: [{ id: 'gpt-5' }, { id: 'o4-mini' }] };
    expect(applyProviderDefaults(baseOpts, {}, [picked]).options.model).toBe('gpt-5');
    expect(
      applyProviderDefaults({ ...baseOpts, model: 'o4-mini' }, {}, [picked]).options.model,
    ).toBe('o4-mini');
    // An account with nothing picked names no model, and the session start refuses rather than
    // guessing one the endpoint may not serve.
    expect(applyProviderDefaults(baseOpts, {}, [account]).options.model).toBeUndefined();
  });

  it('falls back to the legacy apiKey when no account is enabled', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, apiKey: 'sk-legacy', enabledAccountIds: [] },
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
    // The account still resolves — it just contributes nothing for the adapter to read.
    const merged = applyProviderDefaults(baseOpts, {}, [oauth]);
    expect(merged.options.config).toEqual({});
    expect(merged.accountId).toBe('oauth_1');
  });
});
