import type { SessionId, SessionNotification, WireMessage } from '@linkcode/schema';
import type { LinkCodeSdkClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { createWireMessage, SocketIoTransport } from '@linkcode/transport';
import type { SocketIoServer } from '@linkcode/transport/server';
import { createSocketIoServer } from '@linkcode/transport/server';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchConnectionSource } from '../connection-controller';
import { WorkbenchConnectionController } from '../connection-controller';

const HOST = '127.0.0.1';

interface TestHost {
  readonly endpoint: string;
  readonly port: number;
  close(): Promise<void>;
  notify(title: string): void;
}

async function startHost(port = 0): Promise<TestHost> {
  const server: SocketIoServer = await createSocketIoServer({ host: HOST, port });
  const connections = new Set<Transport>();

  server.onConnection((connection) => {
    connections.add(connection);
    connection.onClose(() => connections.delete(connection));
    connection.onMessage((message) => respond(connection, message));
  });

  return {
    endpoint: `http://${HOST}:${server.port}`,
    port: server.port,
    close: () => server.close(),
    notify(title) {
      const notification: SessionNotification = {
        cwd: '/repo',
        kind: 'claude-code',
        reason: { stopReason: 'end_turn', type: 'turn-completed' },
        sessionId: 'session-recovery' as SessionId,
        title,
      };
      for (const connection of connections) {
        connection.send(createWireMessage({ kind: 'session.notification', notification }));
      }
    },
  };
}

function respond(connection: Transport, message: WireMessage): void {
  const payload = message.payload;
  if (payload.kind === 'ping') {
    connection.send(createWireMessage({ kind: 'pong' }));
  } else if (payload.kind === 'session.list') {
    connection.send(
      createWireMessage({ kind: 'session.listed', replyTo: payload.clientReqId, sessions: [] }),
    );
  }
}

function connectionSource(initialEndpoint: string): {
  source: WorkbenchConnectionSource;
  setEndpoint(endpoint: string): void;
  invalidate(): void;
} {
  let endpoint = initialEndpoint;
  let notify = noop;
  return {
    source: {
      resolve: () => ({
        endpoint,
        transport: new SocketIoTransport({ url: endpoint, options: { timeout: 100 } }),
      }),
      subscribe(callback) {
        notify = callback;
        return () => {
          notify = noop;
        };
      },
    },
    invalidate: () => notify(),
    setEndpoint(nextEndpoint) {
      endpoint = nextEndpoint;
    },
  };
}

async function readyClient(
  controller: WorkbenchConnectionController,
  afterGeneration = 0,
): Promise<LinkCodeSdkClient> {
  await vi.waitFor(
    () => {
      const snapshot = controller.getSnapshot();
      expect(snapshot.status).toBe('ready');
      expect(snapshot.contextGeneration?.id).toBeGreaterThan(afterGeneration);
    },
    { interval: 10, timeout: 5000 },
  );
  return nullthrow(controller.getSnapshot().contextGeneration, 'ready generation missing').client;
}

async function expectRpcAndPush(
  client: LinkCodeSdkClient,
  host: TestHost,
  title: string,
): Promise<void> {
  await expect(client.listSessions()).resolves.toEqual({ data: [] });
  const seen: string[] = [];
  const unsubscribe = client.subscribeSessionNotification((notification) => {
    seen.push(nullthrow(notification.title, 'test notification title missing'));
  });
  host.notify(title);
  await vi.waitFor(() => expect(seen).toEqual([title]));
  unsubscribe();
}

describe('Workbench Socket.IO recovery', () => {
  it('recovers an initial refusal after the daemon starts without a manual retry', async () => {
    const reservation = await startHost();
    const port = reservation.port;
    const endpoint = reservation.endpoint;
    await reservation.close();

    const { source } = connectionSource(endpoint);
    const controller = new WorkbenchConnectionController(source, {
      retry: { maxTimeout: 20, minTimeout: 20 },
    });
    let host: TestHost | null = null;

    try {
      controller.start();
      await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('retrying'));

      host = await startHost(port);
      const client = await readyClient(controller);
      await expectRpcAndPush(client, host, 'initial recovery');
    } finally {
      controller.dispose();
      await host?.close();
    }
  });

  it('restores RPC and push delivery after same-port restart and endpoint migration', async () => {
    let host: TestHost | null = await startHost();
    let migratedHost: TestHost | null = null;
    const connection = connectionSource(host.endpoint);
    const controller = new WorkbenchConnectionController(connection.source, {
      retry: { maxTimeout: 20, minTimeout: 20 },
    });

    try {
      controller.start();
      let client = await readyClient(controller);
      await expectRpcAndPush(client, host, 'first generation');

      const firstGeneration = nullthrow(controller.getSnapshot().contextGeneration).id;
      const samePort = host.port;
      await host.close();
      host = await startHost(samePort);
      connection.invalidate();

      client = await readyClient(controller, firstGeneration);
      await expectRpcAndPush(client, host, 'same-port recovery');

      const secondGeneration = nullthrow(controller.getSnapshot().contextGeneration).id;
      migratedHost = await startHost();
      connection.setEndpoint(migratedHost.endpoint);
      connection.invalidate();

      client = await readyClient(controller, secondGeneration);
      await expectRpcAndPush(client, migratedHost, 'migrated recovery');
    } finally {
      controller.dispose();
      await Promise.allSettled([host.close(), migratedHost?.close()]);
    }
  });
});
