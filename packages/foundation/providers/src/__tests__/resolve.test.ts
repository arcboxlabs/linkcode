import type { Account, AgentKind, AgentRuntimes } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import { serviceById } from '../catalog';
import { detectedLoginSuggestions } from '../detected-logins';
import { resolveBinding, serviceProtocols } from '../resolve';
import { fillTemplate, templatePlaceholders } from '../template';

function account(overrides: Partial<Account>): Account {
  return {
    id: 'acc_test',
    label: 'Test',
    credential: { type: 'api-key', key: 'sk-test' },
    createdAt: 0,
    ...overrides,
  };
}

const ALL_KINDS: AgentKind[] = ['claude-code', 'codex', 'opencode', 'pi', 'grok-build'];

describe('resolveBinding: one explicit endpoint', () => {
  it('locks an oauth account to its own agent', () => {
    const sub = account({ credential: { type: 'oauth', agent: 'claude-code' } });
    expect(resolveBinding(sub, 'claude-code')).toEqual({ tier: 'native' });
    expect(resolveBinding(sub, 'codex')).toEqual({
      tier: 'unavailable',
      reason: 'oauth-other-agent',
    });
  });

  it('routes an anthropic endpoint natively to claude-code, opencode and pi', () => {
    const endpoint = { baseUrl: 'https://api.anthropic.com', protocol: 'anthropic' } as const;
    const anthropic = account({ endpoint });
    for (const kind of ['claude-code', 'opencode', 'pi'] as const) {
      expect(resolveBinding(anthropic, kind)).toEqual({ tier: 'native', ...endpoint });
    }
    expect(resolveBinding(anthropic, 'codex')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('translates an openai-chat endpoint for claude-code and refuses it for codex', () => {
    const endpoint = { baseUrl: 'https://api.example.com/v1', protocol: 'openai-chat' } as const;
    const chat = account({ endpoint });
    expect(resolveBinding(chat, 'claude-code')).toEqual({ tier: 'translate', ...endpoint });
    expect(resolveBinding(chat, 'opencode')).toEqual({ tier: 'native', ...endpoint });
    // Chat Completions is gone from the codex CLI — it can only reach a Responses endpoint.
    expect(resolveBinding(chat, 'codex')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('routes an openai-responses endpoint natively to codex, never translated', () => {
    const endpoint = {
      baseUrl: 'https://api.example.com/v1',
      protocol: 'openai-responses',
    } as const;
    const responses = account({ endpoint });
    expect(resolveBinding(responses, 'codex')).toEqual({ tier: 'native', ...endpoint });
    // The sidecar implements only openai-chat, so this is unavailable rather than translated.
    expect(resolveBinding(responses, 'claude-code')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('keeps a pre-catalog bare key bindable everywhere', () => {
    const legacy = account({});
    for (const kind of ALL_KINDS) {
      expect(resolveBinding(legacy, kind)).toEqual({ tier: 'native' });
    }
  });

  it('binds grok-build only to xAI and pre-catalog bare keys', () => {
    expect(resolveBinding(account({ service: 'xai' }), 'grok-build')).toEqual({ tier: 'native' });
    expect(resolveBinding(account({}), 'grok-build')).toEqual({ tier: 'native' });
    expect(resolveBinding(account({ service: 'openai-api' }), 'grok-build')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });
});

describe('resolveBinding: variant chosen per agent', () => {
  it('gives each agent its own endpoint from one OpenAI API key', () => {
    const openai = account({ service: 'openai-api' });
    // Codex overrides the base URL of its built-in Responses provider.
    expect(resolveBinding(openai, 'codex')).toEqual({
      tier: 'native',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
    });
    // claude-code has no anthropic variant here, so it falls back to the translator over chat.
    expect(resolveBinding(openai, 'claude-code')).toEqual({
      tier: 'translate',
      protocol: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
    });
    // opencode and pi prefer the variant their own catalog knows.
    expect(resolveBinding(openai, 'opencode')).toEqual({
      tier: 'native',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      knownProvider: 'openai',
    });
    expect(resolveBinding(openai, 'pi')).toMatchObject({ knownProvider: 'openai' });
  });

  it('serves every agent natively from one three-variant service', () => {
    const deepseek = account({ service: 'deepseek' });
    expect(resolveBinding(deepseek, 'claude-code')).toEqual({
      tier: 'native',
      protocol: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
    });
    expect(resolveBinding(deepseek, 'codex')).toEqual({
      tier: 'native',
      protocol: 'openai-responses',
      baseUrl: 'https://api.deepseek.com',
    });
    for (const kind of ['opencode', 'pi'] as const) {
      expect(resolveBinding(deepseek, kind)).toEqual({
        tier: 'native',
        protocol: 'openai-chat',
        baseUrl: 'https://api.deepseek.com',
        knownProvider: 'deepseek',
      });
    }
    // No translator anywhere: one key reaches four agents over three different wires.
    expect(resolveBinding(deepseek, 'grok-build')).toEqual({
      tier: 'unavailable',
      reason: 'protocol-unsupported',
    });
  });

  it('reaches codex on every service whose endpoint serves the Responses API', () => {
    // Verified against vendor docs 2026-08: xAI, OpenRouter and Vercel all serve POST /responses
    // at the base URL declared here, so codex must have a target on each.
    const cases = [
      ['xai', 'https://api.x.ai/v1'],
      ['openrouter', 'https://openrouter.ai/api/v1'],
      ['vercel-gateway', 'https://ai-gateway.vercel.sh/v1'],
    ] as const;
    for (const [service, baseUrl] of cases) {
      expect(resolveBinding(account({ service }), 'codex')).toEqual({
        tier: 'native',
        protocol: 'openai-responses',
        baseUrl,
      });
    }
    // Cloudflare's `/compat` path serves chat completions only — its Responses route is elsewhere.
    expect(
      resolveBinding(
        account({
          service: 'cloudflare-gateway',
          endpointParams: { account_id: 'a', gateway_id: 'g' },
        }),
        'codex',
      ),
    ).toEqual({ tier: 'unavailable', reason: 'protocol-unsupported' });
  });

  it('leaves opencode and pi on their known-provider variant when a responses one exists', () => {
    // The added responses variants carry no knownProvider, so provider-routed agents are untouched.
    for (const kind of ['opencode', 'pi'] as const) {
      expect(resolveBinding(account({ service: 'xai' }), kind)).toMatchObject({
        protocol: 'openai-chat',
        knownProvider: 'xai',
      });
    }
  });

  it('prefers a native anthropic variant over translation', () => {
    const openrouter = account({
      service: 'openrouter',
      credential: { type: 'auth-token', token: 'sk-or-v1-x' },
    });
    expect(resolveBinding(openrouter, 'claude-code')).toEqual({
      tier: 'native',
      protocol: 'anthropic',
      baseUrl: 'https://openrouter.ai/api',
    });
    // The same key reaches codex over the Responses shape at the same gateway.
    expect(resolveBinding(openrouter, 'codex')).toEqual({
      tier: 'native',
      protocol: 'openai-responses',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    // The known provider wins over the anthropic variant that protocol order would reach first.
    expect(resolveBinding(openrouter, 'opencode')).toEqual({
      tier: 'native',
      protocol: 'openai-chat',
      baseUrl: 'https://openrouter.ai/api/v1',
      knownProvider: 'openrouter',
    });
  });

  it('fills a templated endpoint from endpointParams, and refuses an unfilled one', () => {
    const params = { account_id: '8f3a', gateway_id: 'prod' };
    expect(
      resolveBinding(
        account({ service: 'cloudflare-anthropic', endpointParams: params }),
        'claude-code',
      ),
    ).toEqual({
      tier: 'native',
      protocol: 'anthropic',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/8f3a/prod/anthropic',
    });
    // A literal `{account_id}` in the URL would 404 quietly; refuse the binding instead.
    expect(resolveBinding(account({ service: 'cloudflare-anthropic' }), 'claude-code')).toEqual({
      tier: 'unavailable',
      reason: 'endpoint-incomplete',
    });
  });

  it('re-resolves an account the pre-variant add flow pinned to one endpoint', () => {
    // What the old add flow persisted for the `openai-api` catalog entry: the endpoint carries no
    // user intent, and honoring it would refuse codex on an account that works today.
    const upgraded = account({
      service: 'openai-api',
      endpoint: { baseUrl: 'https://api.openai.com/v1', protocol: 'openai-chat' },
    });
    expect(resolveBinding(upgraded, 'codex')).toEqual({
      tier: 'native',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
    });
    // It also picks up the known-provider injection, like a freshly created account.
    expect(resolveBinding(upgraded, 'opencode')).toMatchObject({ knownProvider: 'openai' });
  });

  it('keeps a pinned endpoint whose template the catalog cannot match', () => {
    // The stored URL is filled while the variant is templated, so it matches nothing and stays
    // pinned — the pre-variant behavior, which was never broken for these accounts.
    const cloudflare = account({
      service: 'cloudflare-gateway',
      credential: { type: 'auth-token', token: 'cf' },
      endpoint: {
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/8f3a/prod/compat',
        protocol: 'openai-chat',
      },
    });
    expect(resolveBinding(cloudflare, 'claude-code')).toMatchObject({
      tier: 'translate',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/8f3a/prod/compat',
    });
  });

  it('lets an explicit endpoint outrank the catalog while keeping the known provider', () => {
    const pinned = account({
      service: 'openrouter',
      credential: { type: 'auth-token', token: 'sk-or-v1-x' },
      endpoint: { baseUrl: 'https://proxy.example.com/v1', protocol: 'openai-chat' },
    });
    expect(resolveBinding(pinned, 'opencode')).toEqual({
      tier: 'native',
      protocol: 'openai-chat',
      baseUrl: 'https://proxy.example.com/v1',
      knownProvider: 'openrouter',
    });
  });
});

describe('catalog helpers', () => {
  it('reports every protocol shape a service serves', () => {
    expect(serviceProtocols('openai-api')).toEqual(['openai-chat', 'openai-responses']);
    expect(serviceProtocols('openrouter')).toEqual([
      'anthropic',
      'openai-chat',
      'openai-responses',
    ]);
    expect(serviceProtocols('claude-sub')).toEqual([]);
    expect(serviceProtocols(undefined)).toEqual([]);
  });

  it('extracts and fills endpoint template placeholders', () => {
    const cloudflare = serviceById('cloudflare-anthropic');
    if (cloudflare?.kind !== 'endpoint') throw new Error('cloudflare descriptor missing');
    const template = nullthrow(cloudflare.variants.anthropic, 'anthropic variant missing').baseUrl;
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
});
