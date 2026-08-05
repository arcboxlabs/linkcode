import type { Account, AgentRuntimes } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { bindingAvailability } from '../capability';
import {
  accountProtocol,
  detectedLoginSuggestions,
  fillTemplate,
  serviceById,
  templatePlaceholders,
} from '../catalog';

function account(overrides: Partial<Account>): Account {
  return {
    id: 'acc_test',
    label: 'Test',
    credential: { type: 'api-key', key: 'sk-test' },
    createdAt: 0,
    ...overrides,
  };
}

describe('bindingAvailability', () => {
  it('locks an oauth account to its own agent', () => {
    const sub = account({ credential: { type: 'oauth', agent: 'claude-code' } });
    expect(bindingAvailability(sub, 'claude-code')).toEqual({ tier: 'native' });
    expect(bindingAvailability(sub, 'codex')).toEqual({
      tier: 'unavailable',
      reason: 'oauth-other-agent',
    });
  });

  it('routes anthropic endpoints natively to claude-code only', () => {
    const anthropic = account({
      endpoint: { baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' },
    });
    expect(bindingAvailability(anthropic, 'claude-code')).toEqual({ tier: 'native' });
    expect(bindingAvailability(anthropic, 'codex')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
    expect(bindingAvailability(anthropic, 'opencode')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('translates openai-chat endpoints for claude-code, native elsewhere', () => {
    const gateway = account({
      credential: { type: 'auth-token', token: 'sk-or-v1-x' },
      endpoint: { baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai-chat' },
    });
    expect(bindingAvailability(gateway, 'claude-code')).toEqual({ tier: 'translate' });
    expect(bindingAvailability(gateway, 'codex')).toEqual({ tier: 'native' });
    expect(bindingAvailability(gateway, 'opencode')).toEqual({ tier: 'native' });
    expect(bindingAvailability(gateway, 'pi')).toEqual({ tier: 'native' });
    expect(bindingAvailability(gateway, 'grok-build')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('routes each DeepSeek protocol through the matching native agent', () => {
    const chat = account({
      service: 'deepseek',
      endpoint: { baseUrl: 'https://api.deepseek.com', protocol: 'openai-chat' },
    });
    const responses = account({
      service: 'deepseek',
      endpoint: { baseUrl: 'https://api.deepseek.com', protocol: 'openai-responses' },
    });
    const anthropic = account({
      service: 'deepseek',
      endpoint: { baseUrl: 'https://api.deepseek.com/anthropic', protocol: 'anthropic' },
    });
    expect(bindingAvailability(chat, 'claude-code')).toEqual({ tier: 'translate' });
    expect(bindingAvailability(chat, 'codex')).toEqual({ tier: 'native' });
    expect(bindingAvailability(chat, 'opencode')).toEqual({ tier: 'native' });
    expect(bindingAvailability(chat, 'pi')).toEqual({ tier: 'native' });
    expect(bindingAvailability(responses, 'codex')).toEqual({ tier: 'native' });
    expect(bindingAvailability(anthropic, 'claude-code')).toEqual({ tier: 'native' });
  });

  it('binds Grok Build to xAI catalog accounts', () => {
    expect(bindingAvailability(account({ service: 'xai' }), 'grok-build')).toEqual({
      tier: 'native',
    });
    expect(bindingAvailability(account({ service: 'openai-api' }), 'grok-build')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('needs an endpoint URL before offering translation', () => {
    // A bare openai-chat key (service-implied protocol, no endpoint) cannot be translated — the
    // sidecar forwards to the account's base URL.
    const bareKey = account({ service: 'openai-api' });
    expect(bindingAvailability(bareKey, 'claude-code')).toEqual({
      tier: 'unavailable',
      reason: 'translation-needs-endpoint',
    });
    expect(bindingAvailability(bareKey, 'codex')).toEqual({ tier: 'native' });
  });

  it('keeps protocol-unknown legacy accounts bindable everywhere', () => {
    const legacy = account({});
    for (const kind of ['claude-code', 'codex', 'opencode', 'pi', 'grok-build'] as const) {
      expect(bindingAvailability(legacy, kind)).toEqual({ tier: 'native' });
    }
  });

  it('rejects openai-responses endpoints everywhere but codex', () => {
    const responses = account({
      endpoint: { baseUrl: 'https://example.com/v1', protocol: 'openai-responses' },
    });
    expect(bindingAvailability(responses, 'codex')).toEqual({ tier: 'native' });
    expect(bindingAvailability(responses, 'claude-code')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });
});

describe('catalog helpers', () => {
  it('extracts and fills endpoint template placeholders', () => {
    const cloudflare = serviceById('cloudflare-gateway');
    if (cloudflare?.kind !== 'endpoint') throw new Error('cloudflare descriptor missing');
    const template = cloudflare.variants.find((variant) => variant.id === 'anthropic')!.baseUrl;
    expect(templatePlaceholders(template)).toEqual(['account_id', 'gateway_id']);
    expect(fillTemplate(template, { account_id: '8f3a', gateway_id: 'prod' })).toBe(
      'https://gateway.ai.cloudflare.com/v1/8f3a/prod/anthropic',
    );
  });

  it('suggests detected CLI logins the pool does not represent yet', () => {
    const runtimes: AgentRuntimes = {
      'claude-code': {
        status: 'available',
        auth: { loggedIn: true, method: 'claude.ai', subscriptionType: 'max', email: 'x@y.z' },
      },
      codex: { status: 'available', auth: { loggedIn: false } },
    };
    const suggested = detectedLoginSuggestions([], runtimes);
    expect(suggested.map(({ service, auth }) => [service.id, auth.email])).toEqual([
      ['claude-sub', 'x@y.z'],
    ]);
    // An existing oauth account for the agent absorbs the suggestion; unprobed runtimes yield none.
    const claudeSub = account({ credential: { type: 'oauth', agent: 'claude-code' } });
    expect(detectedLoginSuggestions([claudeSub], runtimes)).toEqual([]);
    expect(detectedLoginSuggestions([], undefined)).toEqual([]);
  });

  it('implies a protocol from the service when the endpoint is absent', () => {
    expect(accountProtocol(account({ service: 'anthropic-api' }))).toBe('anthropic');
    expect(accountProtocol(account({ service: 'xai' }))).toBe('openai-chat');
    // Multi-protocol services imply nothing without an endpoint.
    expect(accountProtocol(account({ service: 'deepseek' }))).toBeUndefined();
    expect(accountProtocol(account({ service: 'openrouter' }))).toBeUndefined();
    expect(accountProtocol(account({}))).toBeUndefined();
    // An explicit endpoint always wins.
    expect(
      accountProtocol(
        account({
          service: 'openrouter',
          endpoint: { baseUrl: 'https://openrouter.ai/api', protocol: 'anthropic' },
        }),
      ),
    ).toBe('anthropic');
  });

  it('seeds all official DeepSeek protocol endpoints', () => {
    const deepseek = serviceById('deepseek');
    expect(deepseek).toMatchObject({
      id: 'deepseek',
      group: 'direct',
      kind: 'endpoint',
    });
    if (deepseek?.kind !== 'endpoint') throw new Error('deepseek descriptor missing');
    expect(deepseek.variants).toEqual([
      {
        id: 'openai',
        protocol: 'openai-chat',
        baseUrl: 'https://api.deepseek.com',
        credentialType: 'api-key',
      },
      {
        id: 'responses',
        protocol: 'openai-responses',
        baseUrl: 'https://api.deepseek.com',
        credentialType: 'api-key',
      },
      {
        id: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://api.deepseek.com/anthropic',
        credentialType: 'api-key',
      },
    ]);
  });
});
