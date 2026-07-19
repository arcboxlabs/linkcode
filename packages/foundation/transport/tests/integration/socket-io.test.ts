import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SocketIoTransport } from '@linkcode/transport';
import type { SocketIoServer } from '@linkcode/transport/server';
import { createSocketIoServer } from '@linkcode/transport/server';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { describe, expect, it, vi } from 'vitest';

describe('SocketIoTransport connection lifetime', () => {
  it('does not reconnect after the initial connection attempt fails', async () => {
    const portHolder = await createSocketIoServer({ port: 0, host: '127.0.0.1' });
    const port = portHolder.port;
    await portHolder.close();

    const transport = new SocketIoTransport({ url: `http://127.0.0.1:${port}` });
    let server: SocketIoServer | null = null;
    try {
      await expect(transport.connect()).rejects.toThrow();

      let connections = 0;
      server = await createSocketIoServer({ port, host: '127.0.0.1' });
      server.onConnection(() => {
        connections += 1;
      });

      await wait(1800);
      expect(connections).toBe(0);
    } finally {
      transport.close();
      await server?.close();
    }
  });

  it('does not reconnect the same transport after its server restarts', async () => {
    let firstServer: SocketIoServer | null = await createSocketIoServer({
      port: 0,
      host: '127.0.0.1',
    });
    const port = firstServer.port;
    const transport = new SocketIoTransport({ url: `http://127.0.0.1:${port}` });
    const onClose = vi.fn();
    transport.onClose(onClose);

    let restartedServer: SocketIoServer | null = null;
    let replacement: SocketIoTransport | null = null;
    try {
      await transport.connect();
      await expect(transport.connect()).rejects.toThrow('already started');

      await firstServer.close();
      firstServer = null;
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());

      let restartedConnections = 0;
      restartedServer = await createSocketIoServer({ port, host: '127.0.0.1' });
      restartedServer.onConnection(() => {
        restartedConnections += 1;
      });

      // Socket.IO's default first reconnect delay is at most 1.5 seconds with jitter.
      await wait(1800);
      expect(restartedConnections).toBe(0);

      replacement = new SocketIoTransport({ url: `http://127.0.0.1:${port}` });
      await replacement.connect();
      expect(restartedConnections).toBe(1);
    } finally {
      transport.close();
      replacement?.close();
      await restartedServer?.close();
      await firstServer?.close();
    }
  });

  it('rejects an in-flight connect when explicitly closed', async () => {
    // The empty handler keeps Engine.IO's initial polling request open until the client is closed.
    const httpServer = createServer(noop);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const port = (httpServer.address() as AddressInfo).port;
    const transport = new SocketIoTransport({
      url: `http://127.0.0.1:${port}`,
      options: { timeout: 10000 },
    });

    try {
      const connecting = transport.connect();
      transport.close();
      const outcome = await Promise.race([
        connecting.then(() => 'resolved' as const).catch(() => 'rejected' as const),
        wait(100).then(() => 'pending' as const),
      ]);

      expect(outcome).toBe('rejected');
    } finally {
      transport.close();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
