import { MIN_COMPATIBLE_WIRE_VERSION, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { createWsServer, Hub } from '@linkcode/transport/server';
import { describe, expect, it } from 'vitest';

describe('WsServer below-floor handshake', () => {
  it('answers a ping stamped below the floor with the version range the peer must update into', async () => {
    const server = await createWsServer({ port: 0, host: '127.0.0.1' });
    const hub = new Hub();
    server.onConnection((connection) => hub.addConnection(connection));
    // A raw socket: the real transport always stamps this build's version, and the point is a
    // frame an older build would send.
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    try {
      const answer = new Promise<unknown>((resolve) => {
        socket.addEventListener('message', (event) => resolve(JSON.parse(String(event.data))));
      });
      await new Promise<void>((resolve) => {
        socket.addEventListener('open', () => resolve());
      });
      socket.send(
        JSON.stringify({
          v: MIN_COMPATIBLE_WIRE_VERSION - 1,
          id: 'message-1',
          ts: Date.now(),
          payload: { kind: 'ping' },
        }),
      );
      expect(await answer).toMatchObject({
        v: WIRE_PROTOCOL_VERSION,
        payload: {
          kind: 'pong',
          version: WIRE_PROTOCOL_VERSION,
          minCompatible: MIN_COMPATIBLE_WIRE_VERSION,
        },
      });
    } finally {
      socket.close();
      hub.close();
      await server.close();
    }
  });
});
