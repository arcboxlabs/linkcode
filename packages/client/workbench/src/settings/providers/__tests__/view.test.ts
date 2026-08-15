import type { Accounts, AgentRuntimes, ProvidersConfig } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { updateAccountFromDraft } from '../add-flow';
import {
  accountConfigSnippet,
  boundAgentKinds,
  maskSecret,
  providerAccountListViewModel,
  withAccountEnabled,
  withoutAccount,
} from '../view';

const providers: ProvidersConfig = {
  'claude-code': { enabled: true, enabledAccountIds: ['acc_a'] },
  codex: { enabled: false, enabledAccountIds: ['acc_b'] },
  opencode: { enabled: true },
};

describe('provider config transforms', () => {
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

  it('empties the enabled list rather than dropping it, which would re-offer everything', () => {
    const pool: Accounts = [
      { id: 'acc_a', label: 'A', credential: { type: 'api-key', key: 'k' }, createdAt: 0 },
    ];
    const next = withAccountEnabled(providers, 'claude-code', 'acc_a', false, pool);
    expect(next['claude-code']?.enabledAccountIds).toEqual([]);
  });

  it('drops a removed account from every enabled list, identity-stable when none named it', () => {
    const next = withoutAccount(providers, 'acc_a');
    expect(next['claude-code']).toEqual({ enabled: true, enabledAccountIds: [] });
    expect(next.codex).toEqual({ enabled: false, enabledAccountIds: ['acc_b'] });
    expect(withoutAccount(providers, 'acc_missing')).toBe(providers);
  });
});

describe('view helpers', () => {
  it('lists the agents offering this account in stable order, and snippets them', () => {
    const anthropic: Accounts[number] = {
      id: 'acc_a',
      label: 'Anthropic',
      service: 'anthropic-api',
      credential: { type: 'api-key', key: 'k' },
      createdAt: 0,
    };
    // `opencode` and `pi` name no list, which means every bindable account — including this one.
    // `codex` lists only `acc_b`, and `grok-build` takes no endpoint at all.
    expect(boundAgentKinds(anthropic, providers)).toEqual(['claude-code', 'opencode', 'pi']);
    const snippet = accountConfigSnippet(anthropic, providers);
    expect(JSON.parse(snippet)).toEqual({
      providers: {
        'claude-code': { enabled: true, enabledAccountIds: ['acc_a'] },
        opencode: { enabled: true },
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
          // Enabled for claude-code by name, and for the two endpoint-agnostic agents by an absent
          // list; codex lists only acc_b, and grok-build takes no endpoint at all.
          boundAgents: ['claude-code', 'opencode', 'pi'],
        },
        {
          id: 'acc_b',
          label: 'Claude subscription',
          service: 'claude-sub',
          serviceLabel: 'Claude',
          credentialType: 'oauth',
          auth: { loggedIn: true, email: 'claude@example.com' },
          // An oauth login serves only its own agent, and claude-code's list does not name it.
          boundAgents: [],
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
          boundAgents: ['opencode', 'pi'],
        },
      ],
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
