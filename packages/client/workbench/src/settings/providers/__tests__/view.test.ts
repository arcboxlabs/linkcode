import type { Accounts, AgentRuntimes, ProvidersConfig } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { updateAccountFromDraft } from '../add-flow';
import {
  accountConfigSnippet,
  boundAgentKinds,
  maskSecret,
  providerAccountListViewModel,
  withAccountEnabled,
  withDefaultAccount,
  withModel,
  withoutAccount,
} from '../view';

const providers: ProvidersConfig = {
  'claude-code': { enabled: true, activeAccountId: 'acc_a', model: 'claude-opus-4-8' },
  codex: { enabled: false, activeAccountId: 'acc_b' },
  opencode: { enabled: true },
};

describe('provider config transforms', () => {
  it('sets the default while preserving the entry and defaults enabled for a fresh kind', () => {
    const next = withDefaultAccount(providers, 'codex', 'acc_a');
    expect(next.codex).toEqual({ enabled: false, activeAccountId: 'acc_a' });
    expect(withDefaultAccount(providers, 'pi', 'acc_a').pi).toEqual({
      enabled: true,
      activeAccountId: 'acc_a',
    });
  });

  it('clears the default by dropping only activeAccountId', () => {
    const next = withDefaultAccount(providers, 'claude-code', undefined);
    expect(next['claude-code']).toEqual({ enabled: true, model: 'claude-opus-4-8' });
  });

  it('drops a pick the newly bound account does not offer, and keeps one it does', () => {
    const offers = (id: string, models: string[]): Accounts[number] => ({
      id,
      label: id,
      credential: { type: 'api-key', key: 'k' },
      models: models.map((model) => ({ id: model })),
      createdAt: 0,
    });
    const pool = [offers('acc_keep', ['claude-opus-4-8']), offers('acc_drop', ['deepseek-v4-pro'])];

    // Moving the default to an account that lists the pick leaves it alone.
    expect(withDefaultAccount(providers, 'claude-code', 'acc_keep', pool)['claude-code']).toEqual({
      enabled: true,
      activeAccountId: 'acc_keep',
      model: 'claude-opus-4-8',
    });
    // One that does not would otherwise start the next session on a model it never listed.
    expect(withDefaultAccount(providers, 'claude-code', 'acc_drop', pool)['claude-code']).toEqual({
      enabled: true,
      activeAccountId: 'acc_drop',
    });
  });

  it('sets and clears the default model without touching the binding', () => {
    expect(withModel(providers, 'claude-code', 'claude-sonnet-5')['claude-code']).toEqual({
      enabled: true,
      activeAccountId: 'acc_a',
      model: 'claude-sonnet-5',
    });
    expect(withModel(providers, 'claude-code', undefined)['claude-code']).toEqual({
      enabled: true,
      activeAccountId: 'acc_a',
    });
  });

  it('materializes the enabled list from what is bindable on the first disable', () => {
    const pool: Accounts = [
      { id: 'acc_a', label: 'A', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
      { id: 'acc_b', label: 'B', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
    ];

    // Absent means "all bindable", so disabling one has to write the rest down explicitly.
    const disabled = withAccountEnabled(providers, 'opencode', 'acc_a', false, pool);
    expect(disabled.opencode?.enabledAccountIds).toEqual(['acc_b']);
    // Re-enabling puts it back without duplicating.
    const reEnabled = withAccountEnabled(disabled, 'opencode', 'acc_a', true, pool);
    expect(reEnabled.opencode?.enabledAccountIds).toEqual(['acc_b', 'acc_a']);
  });

  it('clears the default when the account serving it is disabled', () => {
    const pool: Accounts = [
      { id: 'acc_a', label: 'A', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
    ];
    // Leaving it would keep resolving unpinned sessions onto an account just removed from the menu.
    const next = withAccountEnabled(providers, 'claude-code', 'acc_a', false, pool);
    expect(next['claude-code']?.activeAccountId).toBeUndefined();
    expect(next['claude-code']?.enabledAccountIds).toEqual([]);
  });

  it('leaves the default alone when a non-default account is disabled', () => {
    const pool: Accounts = [
      { id: 'acc_a', label: 'A', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
      { id: 'acc_b', label: 'B', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
    ];
    const next = withAccountEnabled(providers, 'claude-code', 'acc_b', false, pool);
    expect(next['claude-code']?.activeAccountId).toBe('acc_a');
  });

  it('clears every binding of a removed account, identity-stable when none matched', () => {
    const next = withoutAccount(providers, 'acc_a');
    expect(next['claude-code']).toEqual({ enabled: true, model: 'claude-opus-4-8' });
    expect(next.codex).toEqual({ enabled: false, activeAccountId: 'acc_b' });
    expect(withoutAccount(providers, 'acc_missing')).toBe(providers);
  });
});

describe('view helpers', () => {
  it('lists bound agents in stable order and renders the config snippet from them', () => {
    expect(boundAgentKinds(providers, 'acc_a')).toEqual(['claude-code']);
    const snippet = accountConfigSnippet(providers, 'acc_a');
    expect(JSON.parse(snippet)).toEqual({
      providers: {
        'claude-code': { enabled: true, activeAccountId: 'acc_a', model: 'claude-opus-4-8' },
      },
    });
  });

  it('masks short secrets entirely and long ones tail-anchored', () => {
    expect(maskSecret('short')).toBe('••••••••');
    expect(maskSecret('sk-or-v1-9f2c7ae841b0d63f5e2a')).toBe('sk-or-…5e2a');
  });

  it('prepares account rows and unrepresented CLI logins for presentation', () => {
    const accounts: Accounts = [
      {
        id: 'acc_a',
        label: 'Primary API',
        createdAt: 1,
        service: 'openai-api',
        endpoint: { baseUrl: 'https://api.openai.com/v1', protocol: 'openai-chat' },
        credential: { type: 'api-key', key: 'secret' },
      },
      {
        id: 'acc_b',
        label: 'Claude subscription',
        createdAt: 2,
        service: 'claude-sub',
        credential: { type: 'oauth', agent: 'claude-code' },
      },
      {
        id: 'acc_c',
        label: 'Proxy',
        createdAt: 3,
        service: 'openrouter',
        endpoint: { baseUrl: 'https://proxy.internal/v1', protocol: 'openai-chat' },
        credential: { type: 'auth-token', token: 'tok' },
      },
    ];
    const runtimes: AgentRuntimes = {
      'claude-code': {
        status: 'available',
        auth: { loggedIn: true, email: 'claude@example.com' },
      },
      codex: { status: 'available', auth: { loggedIn: true, email: 'codex@example.com' } },
    };

    const view = providerAccountListViewModel(accounts, providers, runtimes);

    expect(view).toEqual({
      accounts: [
        {
          id: 'acc_a',
          label: 'Primary API',
          service: 'openai-api',
          serviceLabel: 'OpenAI API',
          // The stored endpoint is the catalog's own, so the row describes the service's shapes —
          // the same answer the resolver gives, rather than a pin it will ignore.
          routing: { kind: 'catalog', protocols: ['openai-chat', 'openai-responses'] },
          credentialType: 'api-key',
          boundAgents: ['claude-code'],
        },
        {
          id: 'acc_b',
          label: 'Claude subscription',
          service: 'claude-sub',
          serviceLabel: 'Claude',
          credentialType: 'oauth',
          auth: { loggedIn: true, email: 'claude@example.com' },
          boundAgents: ['codex'],
        },
        {
          id: 'acc_c',
          label: 'Proxy',
          service: 'openrouter',
          serviceLabel: 'OpenRouter',
          // A URL the catalog never produces is the user's own, so it stays pinned and the row
          // reports that one endpoint rather than the service's shapes.
          routing: {
            kind: 'pinned',
            baseUrl: 'https://proxy.internal/v1',
            protocol: 'openai-chat',
          },
          credentialType: 'auth-token',
          boundAgents: [],
        },
      ],
      bindingCount: 2,
      agentCount: 5,
    });
  });

  it('updates editable account fields without replacing its identity or hidden fields', () => {
    const account: Accounts[number] = {
      id: 'acc_a',
      label: 'Old gateway',
      createdAt: 123,
      service: 'openrouter',
      credential: { type: 'api-key', key: 'old-secret' },
      endpoint: { baseUrl: 'https://old.example.com/v1', protocol: 'openai-chat' },
      models: [{ id: 'old-model' }],
      extraEnv: { GATEWAY_MODE: 'strict' },
    };

    expect(
      updateAccountFromDraft(account, {
        label: 'New gateway',
        type: 'auth-token',
        secret: 'new-secret',
        baseUrl: 'https://new.example.com/v1',
        protocol: 'anthropic',
        models: [{ id: 'new-model' }],
      }),
    ).toEqual({
      id: 'acc_a',
      label: 'New gateway',
      createdAt: 123,
      service: 'openrouter',
      credential: { type: 'auth-token', token: 'new-secret' },
      endpoint: { baseUrl: 'https://new.example.com/v1', protocol: 'anthropic' },
      models: [{ id: 'new-model' }],
      extraEnv: { GATEWAY_MODE: 'strict' },
    });
  });
});
