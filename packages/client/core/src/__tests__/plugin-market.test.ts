import type { ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage, pong } from '@linkcode/transport';
import { describe, expect, it, vi } from 'vitest';
import { LinkCodeClient } from '../client';

class ControlledTransport implements Transport {
  readonly sent: WirePayload[] = [];
  private readonly messages = new Set<(message: ValidatedWireMessage) => void>();
  private readonly closes = new Set<() => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ValidatedWireMessage): void {
    this.sent.push(message.payload);
  }

  onMessage(cb: (message: ValidatedWireMessage) => void): Unsubscribe {
    this.messages.add(cb);
    return () => this.messages.delete(cb);
  }

  onClose(cb: () => void): Unsubscribe {
    this.closes.add(cb);
    return () => this.closes.delete(cb);
  }

  close(): void {
    for (const cb of this.closes) cb();
  }

  receive(payload: WirePayload): void {
    const message = createWireMessage(payload);
    for (const cb of this.messages) cb(message);
  }
}

async function connect(): Promise<{ client: LinkCodeClient; transport: ControlledTransport }> {
  const transport = new ControlledTransport();
  const client = new LinkCodeClient(transport);
  const connecting = client.connect();
  await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
  transport.receive(pong());
  await connecting;
  return { client, transport };
}

/** The request payload the client just sent, after the ping. */
function lastRequest(
  transport: ControlledTransport,
): Extract<WirePayload, { clientReqId: string }> {
  const request = transport.sent.at(-1);
  if (request === undefined || !('clientReqId' in request)) {
    throw new Error('expected a correlated request payload');
  }
  return request;
}

describe('LinkCodeClient plugin-market / plugin-config requests', () => {
  it('lists the configured marketplaces', async () => {
    const { client, transport } = await connect();
    const pending = client.listPluginMarketplaces();
    const request = lastRequest(transport);
    expect(request.kind).toBe('plugin-market.list.get');

    transport.receive({
      kind: 'plugin-market.listed',
      replyTo: request.clientReqId,
      marketplaces: [
        {
          id: 'linkcode-official',
          displayName: 'LinkCode Official',
          source: { type: 'remote', url: 'https://plugins.linkcode.ai/index.json' },
          enabled: true,
        },
      ],
    });

    await expect(pending).resolves.toEqual([
      {
        id: 'linkcode-official',
        displayName: 'LinkCode Official',
        source: { type: 'remote', url: 'https://plugins.linkcode.ai/index.json' },
        enabled: true,
      },
    ]);
    client.dispose();
  });

  it('refreshes a marketplace and resolves with its releases, notModified included', async () => {
    const { client, transport } = await connect();
    const pending = client.refreshPluginMarketplace('linkcode-official');
    const request = lastRequest(transport);
    expect(request).toMatchObject({
      kind: 'plugin-market.refresh',
      marketplaceId: 'linkcode-official',
    });

    transport.receive({
      kind: 'plugin-market.refreshed',
      replyTo: request.clientReqId,
      marketplaceId: 'linkcode-official',
      releases: [],
      notModified: true,
    });

    await expect(pending).resolves.toEqual({
      marketplaceId: 'linkcode-official',
      releases: [],
      notModified: true,
    });
    client.dispose();
  });

  it('installs a release and resolves with the installed identity', async () => {
    const { client, transport } = await connect();
    const release = {
      marketplaceId: 'linkcode-official',
      pluginId: 'linkcode/mail',
      version: '1.0.0',
    };
    const pending = client.installLinkCodePlugin(release);
    const request = lastRequest(transport);
    expect(request).toMatchObject({ kind: 'plugin-market.install', release });

    transport.receive({
      kind: 'plugin-market.installed',
      replyTo: request.clientReqId,
      ...release,
    });

    await expect(pending).resolves.toEqual(release);
    client.dispose();
  });

  it('uninstalls a plugin and resolves with its id', async () => {
    const { client, transport } = await connect();
    const pending = client.uninstallLinkCodePlugin('linkcode/mail');
    const request = lastRequest(transport);
    expect(request).toMatchObject({ kind: 'plugin-market.uninstall', pluginId: 'linkcode/mail' });

    transport.receive({
      kind: 'plugin-market.uninstalled',
      replyTo: request.clientReqId,
      pluginId: 'linkcode/mail',
    });

    await expect(pending).resolves.toBe('linkcode/mail');
    client.dispose();
  });

  it('lists masked plugin configs', async () => {
    const { client, transport } = await connect();
    const pending = client.listLinkCodePluginConfigs();
    const request = lastRequest(transport);
    expect(request.kind).toBe('plugin-config.list.get');

    const view = {
      id: 'linkcode/mail',
      version: '1.0.0',
      settings: {
        account: { type: 'string', required: true },
        password: { type: 'password', secret: true, required: true },
      },
      values: { account: 'you@163.com' },
      configuredSecrets: ['password'] as string[],
    } as const;
    transport.receive({
      kind: 'plugin-config.listed',
      replyTo: request.clientReqId,
      plugins: [view],
    });

    await expect(pending).resolves.toEqual([view]);
    client.dispose();
  });

  it('applies a per-key settings patch and resolves with the masked values', async () => {
    const { client, transport } = await connect();
    const pending = client.setLinkCodePluginConfig({
      pluginId: 'linkcode/mail',
      set: { preset: 'qq', readonly: true },
      remove: ['api.key'],
    });
    const request = lastRequest(transport);
    expect(request).toMatchObject({
      kind: 'plugin-config.set',
      pluginId: 'linkcode/mail',
      set: { preset: 'qq', readonly: true },
      remove: ['api.key'],
    });

    transport.receive({
      kind: 'plugin-config.updated',
      replyTo: request.clientReqId,
      pluginId: 'linkcode/mail',
      values: { account: 'you@163.com', preset: 'qq', readonly: true },
      configuredSecrets: ['password'],
    });

    await expect(pending).resolves.toEqual({
      pluginId: 'linkcode/mail',
      values: { account: 'you@163.com', preset: 'qq', readonly: true },
      configuredSecrets: ['password'],
    });
    client.dispose();
  });

  it('rejects a request when the host answers request.failed', async () => {
    const { client, transport } = await connect();
    const pending = client.refreshPluginMarketplace('nope');
    const request = lastRequest(transport);

    transport.receive({
      kind: 'request.failed',
      replyTo: request.clientReqId,
      message: 'Unknown marketplace: nope',
      code: 'not_found',
    });

    await expect(pending).rejects.toMatchObject({
      message: 'Unknown marketplace: nope',
      code: 'not_found',
    });
    client.dispose();
  });
});
