import type { AccountEndpoint } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import { modelListHeaders, modelListUrl, probeEndpointModels } from '../agent/model-probe';

const anthropic: AccountEndpoint = { baseUrl: 'https://relay.test/', protocol: 'anthropic' };
const openai: AccountEndpoint = { baseUrl: 'https://relay.test/v1', protocol: 'openai-chat' };
const REJECTION_PATTERN = /401.*invalid api key/;
const NOT_A_LIST_PATTERN = /did not answer a model list/;

function jsonResponse(body: unknown): Response {
  return Response.json(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('endpoint model list addressing', () => {
  it('appends /v1 for Anthropic-shaped base URLs and only /models for OpenAI-shaped ones', () => {
    expect(modelListUrl(anthropic)).toBe('https://relay.test/v1/models?limit=1000');
    expect(modelListUrl(openai)).toBe('https://relay.test/v1/models');
  });

  it('authenticates per protocol and credential shape', () => {
    expect(modelListHeaders(anthropic, { type: 'api-key', key: 'k' })).toMatchObject({
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    });
    expect(modelListHeaders(anthropic, { type: 'auth-token', token: 't' })).toMatchObject({
      authorization: 'Bearer t',
      'anthropic-version': '2023-06-01',
    });
    expect(modelListHeaders(openai, { type: 'api-key', key: 'k' }).authorization).toBe('Bearer k');
  });
});

describe('probeEndpointModels', () => {
  it("reads the vendors' {data} envelope, keeping display names and order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'claude-opus-4', display_name: 'Claude Opus 4' }, { id: 'claude-haiku-4' }],
      }),
    );
    await expect(
      probeEndpointModels(anthropic, { type: 'api-key', key: 'k' }, fetchImpl),
    ).resolves.toEqual([{ id: 'claude-opus-4', label: 'Claude Opus 4' }, { id: 'claude-haiku-4' }]);
  });

  it('accepts a bare array and drops duplicate ids', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 'gpt-5' }, { id: 'gpt-5' }, { id: 'gpt-5-mini' }]));
    await expect(
      probeEndpointModels(openai, { type: 'api-key', key: 'k' }, fetchImpl),
    ).resolves.toEqual([{ id: 'gpt-5' }, { id: 'gpt-5-mini' }]);
  });

  it("surfaces the endpoint's own rejection so the user can act on it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"error":"invalid api key"}', { status: 401 }));
    await expect(
      probeEndpointModels(openai, { type: 'api-key', key: 'bad' }, fetchImpl),
    ).rejects.toThrow(REJECTION_PATTERN);
  });

  it('rejects a response that is not a model list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    await expect(
      probeEndpointModels(openai, { type: 'api-key', key: 'k' }, fetchImpl),
    ).rejects.toThrow(NOT_A_LIST_PATTERN);
  });
});
