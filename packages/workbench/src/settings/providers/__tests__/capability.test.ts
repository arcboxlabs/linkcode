import type { Account } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { bindingAvailability } from '../capability';
import { accountProtocol, fillTemplate, serviceById, templatePlaceholders } from '../catalog';

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
    for (const kind of ['claude-code', 'codex', 'opencode', 'pi'] as const) {
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

  it('implies a protocol from the service when the endpoint is absent', () => {
    expect(accountProtocol(account({ service: 'anthropic-api' }))).toBe('anthropic');
    expect(accountProtocol(account({ service: 'xai' }))).toBe('openai-chat');
    // Dual-protocol gateways imply nothing without an endpoint.
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
});
