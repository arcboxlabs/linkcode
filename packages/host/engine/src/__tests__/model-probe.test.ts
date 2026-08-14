import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServiceModelList } from '@linkcode/providers';
import type { AccountEndpoint } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import type { ModelListRequest } from '../agent/model-probe';
import {
  modelListHeaders,
  modelListUrlFromEndpoint,
  probeEndpointModels,
  requestModelListAtAddress,
  resolvePublicEndpoint,
} from '../agent/model-probe';

const anthropicEndpoint: AccountEndpoint = {
  baseUrl: 'https://relay.test/',
  protocol: 'anthropic',
};
const openaiEndpoint: AccountEndpoint = {
  baseUrl: 'https://relay.test/v1',
  protocol: 'openai-chat',
};
const anthropic: ServiceModelList = { url: 'https://relay.test/v1/models', wire: 'anthropic' };
const openai: ServiceModelList = { url: 'https://relay.test/v1/models', wire: 'openai' };
const REJECTION_PATTERN = /401.*invalid api key/;
const NOT_A_LIST_PATTERN = /did not answer a model list/;
const HTTP_PATTERN = /HTTP/;
const PRIVATE_PATTERN = /private/;
const EXCEEDED_PATTERN = /exceeded/;
const TIMED_OUT_PATTERN = /timed out/;
const INVALID_ENDPOINT_PATTERN = /cannot contain/;

function jsonResponse(body: unknown): Awaited<ReturnType<ModelListRequest>> {
  return { status: 200, statusText: 'OK', body: JSON.stringify(body) };
}

describe('custom endpoint model list addressing', () => {
  it('appends /v1 for Anthropic-shaped base URLs and only /models for OpenAI-shaped ones', () => {
    // Only custom accounts reach this: catalog services carry an explicit URL instead.
    expect(modelListUrlFromEndpoint(anthropicEndpoint)).toBe(
      'https://relay.test/v1/models?limit=1000',
    );
    expect(modelListUrlFromEndpoint(openaiEndpoint)).toBe('https://relay.test/v1/models');
  });

  it('rejects URL components that string-appending could misaddress', () => {
    expect(() =>
      modelListUrlFromEndpoint({
        baseUrl: 'https://relay.test/v1?tenant=x',
        protocol: 'openai-chat',
      }),
    ).toThrow(INVALID_ENDPOINT_PATTERN);
    expect(() =>
      modelListUrlFromEndpoint({
        baseUrl: 'https://user:secret@relay.test/v1',
        protocol: 'openai-chat',
      }),
    ).toThrow(INVALID_ENDPOINT_PATTERN);
  });

  it('authenticates per wire and credential shape', () => {
    expect(modelListHeaders('anthropic', { type: 'api-key', key: 'k' })).toMatchObject({
      'x-api-key': 'k',
      'anthropic-version': '2023-06-01',
    });
    expect(modelListHeaders('anthropic', { type: 'auth-token', token: 't' })).toMatchObject({
      authorization: 'Bearer t',
      'anthropic-version': '2023-06-01',
    });
    expect(modelListHeaders('openai', { type: 'api-key', key: 'k' }).authorization).toBe(
      'Bearer k',
    );
  });
});

describe('probeEndpointModels', () => {
  it("reads the vendors' {data} envelope, keeping display names and order", async () => {
    const request = vi.fn<ModelListRequest>().mockResolvedValue(
      jsonResponse({
        data: [{ id: 'claude-opus-4', display_name: 'Claude Opus 4' }, { id: 'claude-haiku-4' }],
      }),
    );
    await expect(
      probeEndpointModels(anthropic, { type: 'api-key', key: 'k' }, request),
    ).resolves.toEqual([{ id: 'claude-opus-4', label: 'Claude Opus 4' }, { id: 'claude-haiku-4' }]);
  });

  it('accepts a bare array and drops duplicate ids', async () => {
    const request = vi
      .fn<ModelListRequest>()
      .mockResolvedValue(jsonResponse([{ id: 'gpt-5' }, { id: 'gpt-5' }, { id: 'gpt-5-mini' }]));
    await expect(
      probeEndpointModels(openai, { type: 'api-key', key: 'k' }, request),
    ).resolves.toEqual([{ id: 'gpt-5' }, { id: 'gpt-5-mini' }]);
  });

  it("surfaces the endpoint's own rejection so the user can act on it", async () => {
    const request = vi.fn<ModelListRequest>().mockResolvedValue({
      status: 401,
      statusText: 'Unauthorized',
      body: '{"error":"invalid api key"}',
    });
    await expect(
      probeEndpointModels(openai, { type: 'api-key', key: 'bad' }, request),
    ).rejects.toThrow(REJECTION_PATTERN);
  });

  it('rejects a response that is not a model list', async () => {
    const request = vi.fn<ModelListRequest>().mockResolvedValue(jsonResponse({ ok: true }));
    await expect(
      probeEndpointModels(openai, { type: 'api-key', key: 'k' }, request),
    ).rejects.toThrow(NOT_A_LIST_PATTERN);
  });
});

describe('model probe network boundary', () => {
  it('rejects unsupported schemes and private destinations', async () => {
    await expect(resolvePublicEndpoint(new URL('file:///tmp/models'))).rejects.toThrow(
      HTTP_PATTERN,
    );
    await expect(resolvePublicEndpoint(new URL('http://127.0.0.1/models'))).rejects.toThrow(
      PRIVATE_PATTERN,
    );
    await expect(resolvePublicEndpoint(new URL('http://[::1]/models'))).rejects.toThrow(
      PRIVATE_PATTERN,
    );
    await expect(resolvePublicEndpoint(new URL('http://[fec0::1]/models'))).rejects.toThrow(
      PRIVATE_PATTERN,
    );
    await expect(resolvePublicEndpoint(new URL('http://[64:ff9b::7f00:1]/models'))).rejects.toThrow(
      PRIVATE_PATTERN,
    );
  });

  it('enforces an absolute deadline', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<ModelListRequest>(
        (_url, _headers, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error(String(signal.reason))), {
              once: true,
            });
          }),
      );
      const result = probeEndpointModels(openai, { type: 'api-key', key: 'k' }, request);
      const expectation = expect(result).rejects.toThrow(TIMED_OUT_PATTERN);
      await vi.advanceTimersByTimeAsync(10000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not follow a redirect carrying an x-api-key', async () => {
    let redirectedRequests = 0;
    const redirected = createServer((_request, response) => {
      redirectedRequests += 1;
      response.end('{}');
    });
    await new Promise<void>((resolve) => {
      redirected.listen(0, '127.0.0.1', resolve);
    });
    const redirectedPort = (redirected.address() as AddressInfo).port;
    const source = createServer((_request, response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${redirectedPort}/steal` });
      response.end();
    });
    await new Promise<void>((resolve) => {
      source.listen(0, '127.0.0.1', resolve);
    });
    const sourcePort = (source.address() as AddressInfo).port;
    try {
      const result = await requestModelListAtAddress(
        new URL(`http://relay.test:${sourcePort}/models`),
        { 'x-api-key': 'secret' },
        { address: '127.0.0.1', family: 4 },
      );
      expect(result.status).toBe(302);
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all(
        [source, redirected].map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
            }),
        ),
      );
    }
  });

  it('rejects an oversized successful response', async () => {
    const server = createServer((_request, response) => {
      response.end('x'.repeat(1024 * 1024 + 1));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        requestModelListAtAddress(
          new URL(`http://relay.test:${port}/models`),
          {},
          { address: '127.0.0.1', family: 4 },
        ),
      ).rejects.toThrow(EXCEEDED_PATTERN);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('rejects a response that closes before its declared body completes', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-length': '10' });
      response.write('x');
      response.destroy();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(
        requestModelListAtAddress(
          new URL(`http://relay.test:${port}/models`),
          {},
          { address: '127.0.0.1', family: 4 },
        ),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
