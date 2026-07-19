import { describe, expect, it } from 'vitest';
import { parseModelsJson } from '../import-models-json';

const BANNED_FILE = JSON.stringify({
  providers: {
    banned: {
      baseUrl: 'https://ai.banned.dynv6.net/v1',
      api: 'openai-completions',
      apiKey: 'gwen',
      models: [
        {
          id: '@cf/zai-org/glm-5.2',
          name: 'GLM-5.2',
          reasoning: true,
          input: ['text'],
          contextWindow: 262144,
          maxTokens: 16384,
          cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
        },
        {
          id: '@cf/moonshotai/kimi-k2.7-code',
          name: 'Kimi K2.7 Code',
          reasoning: true,
          input: ['text', 'image'],
          contextWindow: 262144,
          maxTokens: 16384,
          cost: { input: 0.95, output: 4.0, cacheRead: 0.19, cacheWrite: 0 },
          thinkingLevelMap: { off: null },
        },
      ],
    },
  },
});

describe('parseModelsJson', () => {
  it('maps a custom provider to an account draft with full model fidelity', () => {
    const result = parseModelsJson(BANNED_FILE);
    expect(result.skipped).toEqual([]);
    expect(result.providers).toHaveLength(1);
    const [banned] = result.providers;
    expect(banned).toMatchObject({
      name: 'banned',
      baseUrl: 'https://ai.banned.dynv6.net/v1',
      protocol: 'openai-chat',
      apiKey: 'gwen',
    });
    expect(banned.models[0]).toEqual({
      id: '@cf/zai-org/glm-5.2',
      name: 'GLM-5.2',
      reasoning: true,
      input: ['text'],
      cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 16384,
    });
    // The manual form drops these; the import path keeps them.
    expect(banned.models[1].thinkingLevelMap).toEqual({ off: null });
    expect(banned.models[1].input).toEqual(['text', 'image']);
  });

  it('fills pi loader defaults for omitted model fields', () => {
    const result = parseModelsJson(
      JSON.stringify({
        providers: {
          mini: {
            baseUrl: 'https://x.test/v1',
            api: 'anthropic-messages',
            apiKey: 'k',
            models: [{ id: 'm1' }],
          },
        },
      }),
    );
    expect(result.providers[0].protocol).toBe('anthropic');
    expect(result.providers[0].models[0]).toEqual({
      id: 'm1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    });
  });

  it('skips entries an account cannot represent, with a reason each', () => {
    const result = parseModelsJson(
      JSON.stringify({
        providers: {
          override: { baseUrl: 'https://o.test' },
          keyless: { baseUrl: 'https://k.test', api: 'openai-completions', models: [{ id: 'm' }] },
          exotic: {
            baseUrl: 'https://e.test',
            api: 'google-generative-ai',
            apiKey: 'k',
            models: [{ id: 'm' }],
          },
          urlless: { api: 'openai-completions', apiKey: 'k', models: [{ id: 'm' }] },
          'team/gw': {
            baseUrl: 'https://t.test',
            api: 'openai-completions',
            apiKey: 'k',
            models: [{ id: 'm' }],
          },
        },
      }),
    );
    expect(result.providers).toEqual([]);
    expect(result.skipped).toEqual([
      { name: 'override', reason: 'no-models' },
      { name: 'keyless', reason: 'missing-api-key' },
      { name: 'exotic', reason: 'unsupported-api' },
      { name: 'urlless', reason: 'missing-base-url' },
      // A '/' in the provider name would make `provider/model` refs ambiguous.
      { name: 'team/gw', reason: 'invalid-name' },
    ]);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseModelsJson('{ // comment\n}')).toThrow();
  });
});
