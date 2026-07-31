import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WirePayload } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeEndpointModels, requestModelListAtAddress } from '../agent/model-probe';
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

const localModelProbe: typeof probeEndpointModels = (endpoint, secret) =>
  probeEndpointModels(endpoint, secret, (url, headers) =>
    requestModelListAtAddress(url, headers, { address: '127.0.0.1', family: 4 }),
  );

function createHarness() {
  return createSessionHarness(undefined, undefined, undefined, undefined, undefined, undefined, {
    modelProbe: localModelProbe,
  });
}

let relay: Server | undefined;

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
      return url === '/v1/models'
        ? { status: 200, body: JSON.stringify({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }] }) }
        : { status: 404, body: '{}' };
    });
    const h = createHarness();
    await h.engine.start();

    await h.inject({
      kind: 'config.probe-models',
      clientReqId: 'probe-1',
      endpoint: { baseUrl: `${baseUrl(relay)}/v1`, protocol: 'openai-chat' },
      secret: { type: 'api-key', key: 'sk-test' },
    });

    await expect(replyFor(h.sent, 'probe-1')).resolves.toEqual({
      kind: 'config.probe-models.result',
      replyTo: 'probe-1',
      models: [{ id: 'gpt-5' }, { id: 'gpt-5-mini' }],
    });
    expect(seen).toEqual(['/v1/models']);
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
      endpoint: { baseUrl: baseUrl(relay), protocol: 'anthropic' },
      secret: { type: 'api-key', key: 'bad' },
    });

    const failed = await replyFor(h.sent, 'probe-2');
    if (failed.kind !== 'request.failed') throw new Error('no request.failed for probe-2');
    expect(failed.message).toContain('401');
    expect(failed.message).toContain('invalid api key');
  });
});
