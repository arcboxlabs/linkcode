import { describe, expect, it, vi } from 'vitest';
import { listEndpointModels } from '../agent/endpoint-models';

function fetchStub(status: number, payload: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(Response.json(payload, { status })));
}

describe('listEndpointModels', () => {
  it('queries {baseUrl}/models with a bearer token for openai endpoints', async () => {
    const fetchFn = fetchStub(200, { data: [{ id: 'gpt-x' }, { id: 'glm-y' }] });
    const models = await listEndpointModels(
      {
        baseUrl: 'https://gw.test/v1/',
        protocol: 'openai-chat',
        secret: 'sk-1',
        credentialType: 'api-key',
      },
      fetchFn,
    );
    expect(models).toEqual([{ id: 'gpt-x' }, { id: 'glm-y' }]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://gw.test/v1/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-1' } }),
    );
  });

  it('queries {baseUrl}/v1/models with x-api-key + version for anthropic api-key endpoints', async () => {
    const fetchFn = fetchStub(200, { data: [{ id: 'claude-z' }] });
    await listEndpointModels(
      {
        baseUrl: 'https://api.anthropic.com',
        protocol: 'anthropic',
        secret: 'sk-ant',
        credentialType: 'api-key',
      },
      fetchFn,
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-ant' },
      }),
    );
  });

  it('uses a bearer token for anthropic auth-token endpoints (gateway skins)', async () => {
    const fetchFn = fetchStub(200, { data: [] });
    await listEndpointModels(
      {
        baseUrl: 'https://openrouter.ai/api',
        protocol: 'anthropic',
        secret: 'sk-or',
        credentialType: 'auth-token',
      },
      fetchFn,
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: { 'anthropic-version': '2023-06-01', Authorization: 'Bearer sk-or' },
      }),
    );
  });

  it('captures OpenRouter context_length as contextWindow, skipping malformed entries', async () => {
    const fetchFn = fetchStub(200, {
      data: [
        { id: 'a/b', context_length: 131072 },
        { id: 'c', context_length: 'big' },
        { noId: 1 },
      ],
    });
    const models = await listEndpointModels(
      {
        baseUrl: 'https://openrouter.ai/api/v1',
        protocol: 'openai-chat',
        secret: 'sk',
        credentialType: 'auth-token',
      },
      fetchFn,
    );
    expect(models).toEqual([{ id: 'a/b', contextWindow: 131072 }, { id: 'c' }]);
  });

  it('rejects on a non-2xx status with the status in the message', async () => {
    await expect(
      listEndpointModels(
        {
          baseUrl: 'https://ai.banned.test/v1',
          protocol: 'openai-chat',
          secret: 'k',
          credentialType: 'api-key',
        },
        fetchStub(404, 'not found'),
      ),
    ).rejects.toThrow('404');
  });

  it('rejects on a shape without a data array', async () => {
    await expect(
      listEndpointModels(
        {
          baseUrl: 'https://x.test/v1',
          protocol: 'openai-chat',
          secret: 'k',
          credentialType: 'api-key',
        },
        fetchStub(200, { models: [] }),
      ),
    ).rejects.toThrow('unexpected response shape');
  });
});
