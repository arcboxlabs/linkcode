import type { ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import { SessionIdSchema, SessionResourceSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage, pong, WsTransport } from '@linkcode/transport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkCodeClient } from '../client';

class ControlledTransport implements Transport {
  readonly sent: WirePayload[] = [];
  readonly connectError?: Error;
  closeCalls = 0;
  private readonly messages = new Set<(message: ValidatedWireMessage) => void>();
  private readonly closes = new Set<() => void>();

  constructor(options: { connectError?: Error } = {}) {
    this.connectError = options.connectError;
  }

  connect(): Promise<void> {
    return this.connectError ? Promise.reject(this.connectError) : Promise.resolve();
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
    this.closeCalls += 1;
    this.disconnect();
  }

  receive(payload: WirePayload): void {
    const message = createWireMessage(payload);
    for (const cb of this.messages) cb(message);
  }

  disconnect(): void {
    for (const cb of this.closes) cb();
  }
}

afterEach(() => vi.useRealTimers());

describe('LinkCodeClient connection lifetime', () => {
  it('rejects transports that hide physical reconnects', () => {
    expect(
      () => new LinkCodeClient(new WsTransport({ url: 'ws://localhost', reconnect: true })),
    ).toThrow('create a fresh client generation');
    expect(
      () =>
        new LinkCodeClient(new WsTransport({ url: 'ws://localhost', reconnect: { baseMs: 500 } })),
    ).toThrow('create a fresh client generation');
    expect(
      () =>
        new LinkCodeClient(
          new WsTransport({ url: 'ws://localhost', reconnect: { maxRetries: 0 } }),
        ),
    ).not.toThrow();
    expect(() => new LinkCodeClient(new WsTransport({ url: 'ws://localhost' }))).not.toThrow();
  });

  it('becomes ready only after a LinkCode pong and cannot connect twice', async () => {
    const transport = new ControlledTransport();
    const client = new LinkCodeClient(transport);
    let ready = false;
    const connecting = client.connect().then(() => {
      ready = true;
    });

    await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
    expect(ready).toBe(false);

    transport.receive(pong());
    await connecting;
    expect(ready).toBe(true);
    expect(client.peerWireVersion).toBe(WIRE_PROTOCOL_VERSION);
    await expect(client.connect()).rejects.toThrow('already started');

    client.dispose();
  });

  it('names the skew when the host has moved its floor past this build', async () => {
    const transport = new ControlledTransport();
    const client = new LinkCodeClient(transport);
    const connecting = expect(client.connect()).rejects.toThrow(
      `this build speaks wire v${WIRE_PROTOCOL_VERSION}, older than the v${WIRE_PROTOCOL_VERSION + 3} the host needs`,
    );

    await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
    transport.receive({
      kind: 'pong',
      version: WIRE_PROTOCOL_VERSION + 5,
      minCompatible: WIRE_PROTOCOL_VERSION + 3,
    });

    await connecting;
    client.dispose();
  });

  it('times out a peer that does not speak the current wire protocol', async () => {
    vi.useFakeTimers();
    const transport = new ControlledTransport();
    const client = new LinkCodeClient(transport);
    const onClose = vi.fn();
    client.onClose(onClose);
    const connecting = expect(client.connect()).rejects.toThrow('handshake timed out');

    await vi.advanceTimersByTimeAsync(5000);
    await connecting;
    expect(transport.closeCalls).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects handshake close without reporting a post-ready close', async () => {
    const transport = new ControlledTransport();
    const client = new LinkCodeClient(transport);
    const onClose = vi.fn();
    client.onClose(onClose);
    const connecting = client.connect();
    await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));

    transport.disconnect();

    await expect(connecting).rejects.toThrow('transport connection closed');
    expect(onClose).not.toHaveBeenCalled();
    client.dispose();
  });

  it('reports a ready connection closing once and rejects pending requests', async () => {
    const transport = new ControlledTransport();
    const client = new LinkCodeClient(transport);
    const onClose = vi.fn();
    client.onClose(onClose);
    const connecting = client.connect();
    await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
    transport.receive(pong());
    await connecting;
    const pending = client.listSessions();

    transport.disconnect();
    transport.disconnect();

    await expect(pending).rejects.toThrow('transport connection closed');
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'transport connection closed' }),
    );
    client.dispose();
  });

  it('keeps initial failure and disposal out of the post-ready close channel', async () => {
    const initialTransport = new ControlledTransport({ connectError: new Error('dial failed') });
    const initialClient = new LinkCodeClient(initialTransport);
    const onInitialClose = vi.fn();
    initialClient.onClose(onInitialClose);

    await expect(initialClient.connect()).rejects.toThrow('dial failed');
    expect(onInitialClose).not.toHaveBeenCalled();
    expect(initialTransport.closeCalls).toBe(1);

    const disposedTransport = new ControlledTransport();
    const disposedClient = new LinkCodeClient(disposedTransport);
    const onDisposedClose = vi.fn();
    disposedClient.onClose(onDisposedClose);
    const connecting = disposedClient.connect();
    await vi.waitFor(() => expect(disposedTransport.sent).toContainEqual({ kind: 'ping' }));

    disposedClient.dispose();

    await expect(connecting).rejects.toThrow('client disposed');
    expect(onDisposedClose).not.toHaveBeenCalled();
  });

  it('correlates resource lists and forwards resource broadcasts', async () => {
    const transport = new ControlledTransport();
    const client = new LinkCodeClient(transport);
    const connecting = client.connect();
    await vi.waitFor(() => expect(transport.sent).toContainEqual({ kind: 'ping' }));
    transport.receive(pong());
    await connecting;
    const sessionId = SessionIdSchema.parse('session-resources');
    const resource = SessionResourceSchema.parse({
      resourceId: 'resource-client-test',
      sessionId,
      direction: 'source',
      name: 'brief.txt',
      kind: 'document',
      status: 'ready',
      locator: { type: 'managed-file', path: '/state/brief.txt' },
      createdAt: 1,
      updatedAt: 1,
    });

    const listed = client.listResources(sessionId);
    const request = transport.sent.find((payload) => payload.kind === 'resource.list');
    if (request?.kind !== 'resource.list') throw new Error('missing resource.list request');
    transport.receive({
      kind: 'resource.listed',
      replyTo: request.clientReqId,
      resources: [resource],
    });
    await expect(listed).resolves.toEqual([resource]);

    const onResource = vi.fn();
    client.subscribeResources(onResource);
    transport.receive({ kind: 'resource.changed', resource });
    transport.receive({
      kind: 'resource.removed',
      resourceId: resource.resourceId,
      sessionId,
    });
    expect(onResource).toHaveBeenNthCalledWith(1, { type: 'changed', resource });
    expect(onResource).toHaveBeenNthCalledWith(2, {
      type: 'removed',
      resourceId: resource.resourceId,
      sessionId,
    });
    client.dispose();
  });
});
