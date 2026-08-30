import type { Server } from 'node:http';
import { Agent, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { EndpointService, ServiceModelList } from '@linkcode/providers';
import type { WirePayload } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeServiceModels, requestPublicModelList } from '../agent/model-probe';
import { InMemoryProviderConfigStore } from '../agent/provider-config';
import { createSessionHarness } from './fixtures/session-harness';

/** The probe is a real HTTP round-trip, so its reply lands after `inject`'s task settle. */
function replyFor(sent: WirePayload[], clientReqId: string): Promise<WirePayload> {
  return vi.waitFor(() =>
    nullthrow(
      sent.find((p) => 'replyTo' in p && p.replyTo === clientReqId),
      `no reply for ${clientReqId}`,
    ),
  );
}

/** A stand-in relay: answers one model-list route and 401s everything else. */
function startRelay(handler: (url: string) => { status: number; body: string }): Promise<Server> {
  const server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '');
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function baseUrl(server: Server): string {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

let relay: Server | undefined;

/** Rewrites every model-list URL a service carries — service-level and per-variant — to the
 * local relay, so the relay records which path each one resolved to while the real HTTP
 * round-trip stays under test. */
function localize(list: ServiceModelList | undefined): ServiceModelList | undefined {
  if (!list) return undefined;
  const resolved = new URL(list.url);
  const local = `${baseUrl(nullthrow(relay, 'relay not started'))}${resolved.pathname}${resolved.search}`;
  return { ...list, url: local };
}

const localModelProbe: typeof probeServiceModels = (service, secret) => {
  const localized: EndpointService = {
    ...service,
    models: localize(service.models),
    variants: Object.entries(service.variants).reduce<EndpointService['variants']>(
      (acc, [protocol, variant]) => {
        acc[protocol as keyof EndpointService['variants']] = variant && {
          ...variant,
          models: localize(variant.models),
        };
        return acc;
      },
      {},
    ),
  };
  // An unguarded agent: the relay is on loopback, which the probe policy exists to refuse.
  return probeServiceModels(localized, secret, (url, headers) =>
    requestPublicModelList(url, headers, undefined, new Agent()),
  );
};

function createHarness(providerStore?: InMemoryProviderConfigStore) {
  return createSessionHarness(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    providerStore,
    { modelProbe: localModelProbe },
  );
}

afterEach(async () => {
  const server = relay;
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
  relay = undefined;
});

describe('config.probe-models', () => {
  it('answers with the models the endpoint serves for an unsaved secret', async () => {
    const seen: string[] = [];
    relay = await startRelay((url) => {
      seen.push(url);
      return url === '/models'
        ? { status: 200, body: JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }) }
        : { status: 404, body: '{}' };
    });
    const h = createHarness();
    await h.engine.start();

    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-1',
      service: 'deepseek',
      credential: { type: 'inline', secret: { type: 'api-key', key: 'sk-test' } },
    });

    // deepseek's three variants share one list (no per-variant override), so both ids are
    // tagged with all three protocols from the single request `seen` below confirms.
    await expect(replyFor(h.sent, 'probe-1')).resolves.toEqual({
      kind: 'config.probe-models.result',
      replyTo: 'probe-1',
      models: [
        { id: 'gpt-5', protocols: ['anthropic', 'openai-chat', 'openai-responses'] },
        { id: 'gpt-5-mini', protocols: ['anthropic', 'openai-chat', 'openai-responses'] },
      ],
    });
    // The service's own path, not one derived from a variant's baseUrl.
    expect(seen).toEqual(['/models']);
  });

  it("relays the endpoint's own rejection to the client", async () => {
    relay = await startRelay(() => ({
      status: 401,
      body: JSON.stringify({ error: 'invalid api key' }),
    }));
    const h = createHarness();
    await h.engine.start();

    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-2',
      service: 'anthropic-api',
      credential: { type: 'inline', secret: { type: 'api-key', key: 'bad' } },
    });

    const failed = await replyFor(h.sent, 'probe-2');
    if (failed.kind !== 'request.failed') throw new Error('no request.failed for probe-2');
    expect(failed.message).toContain('401');
    expect(failed.message).toContain('invalid api key');
  });

  it('refuses a service that serves no model list', async () => {
    const h = createHarness();
    await h.engine.start();

    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-3',
      service: 'cloudflare-gateway',
      credential: { type: 'inline', secret: { type: 'auth-token', token: 'cf' } },
    });

    const failed = await replyFor(h.sent, 'probe-3');
    if (failed.kind !== 'request.failed') throw new Error('no request.failed for probe-3');
    expect(failed.message).toContain('serves no model list');
  });

  it('reads a saved account by id so its secret never travels through the client', async () => {
    const seen: string[] = [];
    relay = await startRelay((url) => {
      seen.push(url);
      return { status: 200, body: JSON.stringify({ data: [{ id: 'deepseek-v4-pro' }] }) };
    });
    const providerStore = new InMemoryProviderConfigStore();
    providerStore.update({
      accounts: [
        {
          id: 'acc_saved',
          label: 'Saved',
          service: 'deepseek',
          credential: { type: 'api-key', key: 'sk-stored' },
          createdAt: 0,
        },
      ],
    });
    const h = createHarness(providerStore);
    await h.engine.start();

    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-4',
      service: 'deepseek',
      credential: { type: 'account', accountId: 'acc_saved' },
    });

    await expect(replyFor(h.sent, 'probe-4')).resolves.toEqual({
      kind: 'config.probe-models.result',
      replyTo: 'probe-4',
      models: [
        { id: 'deepseek-v4-pro', protocols: ['anthropic', 'openai-chat', 'openai-responses'] },
      ],
    });
    expect(seen).toEqual(['/models']);
  });

  it('probes every distinct list a service carries and merges the results', async () => {
    const seen: string[] = [];
    relay = await startRelay((url) => {
      seen.push(url);
      if (url === '/v1/models?protocol=openai-responses') {
        return { status: 200, body: JSON.stringify({ data: [{ id: 'openai/gpt-5.6' }] }) };
      }
      if (url === '/v1/models') {
        return {
          status: 200,
          body: JSON.stringify({
            data: [{ id: 'openai/gpt-5.6' }, { id: 'anthropic/claude-sonnet-5' }],
          }),
        };
      }
      return { status: 404, body: '{}' };
    });
    const h = createHarness();
    await h.engine.start();

    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-7',
      service: 'linkcode-gateway',
      credential: { type: 'inline', secret: { type: 'auth-token', token: 'lc-test' } },
    });

    const reply = await replyFor(h.sent, 'probe-7');
    if (reply.kind !== 'config.probe-models.result') throw new Error('no result for probe-7');
    expect(reply.models).toEqual(
      expect.arrayContaining([
        {
          id: 'openai/gpt-5.6',
          // Returned by both lists: tagged with every protocol whose list named it.
          protocols: ['openai-chat', 'openai-responses'],
        },
        { id: 'anthropic/claude-sonnet-5', protocols: ['openai-chat'] },
      ]),
    );
    expect(reply.models).toHaveLength(2);
    expect(seen.sort()).toEqual(['/v1/models', '/v1/models?protocol=openai-responses']);
  });

  it('refuses to send an account secret to a service it does not belong to', async () => {
    const reached: string[] = [];
    relay = await startRelay((url) => {
      reached.push(url);
      return { status: 200, body: JSON.stringify({ data: [] }) };
    });
    const providerStore = new InMemoryProviderConfigStore();
    providerStore.update({
      accounts: [
        {
          id: 'acc_anthropic',
          label: 'Anthropic',
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-anthropic' },
          createdAt: 0,
        },
        {
          id: 'acc_custom',
          label: 'Custom',
          credential: { type: 'api-key', key: 'sk-custom' },
          createdAt: 0,
        },
      ],
    });
    const h = createHarness(providerStore);
    await h.engine.start();

    // The destination and the credential are independent client-chosen fields; pairing them freely
    // would hand one vendor's key to another.
    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-5',
      service: 'openrouter',
      credential: { type: 'account', accountId: 'acc_anthropic' },
    });
    const crossed = await replyFor(h.sent, 'probe-5');
    if (crossed.kind !== 'request.failed') throw new Error('no request.failed for probe-5');
    expect(crossed.message).toContain('does not belong to the service being probed');

    // A pre-catalog account names no service, so nothing it could legitimately match.
    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-6',
      service: 'deepseek',
      credential: { type: 'account', accountId: 'acc_custom' },
    });
    const serviceless = await replyFor(h.sent, 'probe-6');
    if (serviceless.kind !== 'request.failed') throw new Error('no request.failed for probe-6');
    expect(serviceless.message).toContain('does not belong to the service being probed');

    // Neither request may reach the wire at all.
    expect(reached).toEqual([]);
  });
});
