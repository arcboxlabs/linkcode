import { MIN_COMPATIBLE_WIRE_VERSION, parseWireMessage } from '@linkcode/schema';
import { WsTransport } from '@linkcode/transport';
import { createWsServer } from '@linkcode/transport/server';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../../src/client';
import { WireIncompatibleError } from '../../src/wire-incompatible-error';

describe('LinkCodeClient against an older host', () => {
  it('reads the below-floor pong through the real transport and names the host as the side to update', async () => {
    const server = await createWsServer({ port: 0, host: '127.0.0.1' });
    server.onConnection((connection) => {
      connection.onMessage((message) => {
        if (message.payload.kind !== 'ping') return;
        // What an older host sends back: its own stamp and range, both below this build's floor.
        const olderPong = parseWireMessage({
          v: MIN_COMPATIBLE_WIRE_VERSION - 1,
          id: 'older-pong',
          ts: Date.now(),
          payload: {
            kind: 'pong',
            version: MIN_COMPATIBLE_WIRE_VERSION - 1,
            minCompatible: MIN_COMPATIBLE_WIRE_VERSION - 4,
          },
        });
        if (!olderPong.ok) throw new Error(`fixture pong refused: ${olderPong.reason}`);
        connection.send(olderPong.message);
      });
    });
    const client = new LinkCodeClient(new WsTransport({ url: `ws://127.0.0.1:${server.port}` }));
    try {
      const error = await client
        .connect()
        .then(() => {
          throw new Error('handshake should have failed');
        })
        .catch((error_: unknown) => error_);
      expect(error).toBeInstanceOf(WireIncompatibleError);
      expect(error).toMatchObject({
        remedy: 'update-host',
        peerVersion: MIN_COMPATIBLE_WIRE_VERSION - 1,
        peerMinCompatible: MIN_COMPATIBLE_WIRE_VERSION - 4,
      });
      expect(client.peerWireVersion).toBe(MIN_COMPATIBLE_WIRE_VERSION - 1);
    } finally {
      client.dispose();
      await server.close();
    }
  });
});
