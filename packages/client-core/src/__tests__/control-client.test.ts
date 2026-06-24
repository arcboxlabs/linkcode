import type { PermissionOutcome, SessionId, WirePayload } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../client';

const sessionId = 'sess-control' as SessionId;

describe('LinkCodeClient control API', () => {
  it('waits for control acknowledgements', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    await client.connect();
    await serverTransport.connect();

    serverTransport.onMessage((msg) => {
      const payload = successFor(msg.payload);
      if (payload) serverTransport.send(createWireMessage(payload));
    });

    await expect(client.promptText(sessionId, 'hello')).resolves.toEqual({ ok: true });
    await expect(client.cancel(sessionId)).resolves.toEqual({ ok: true });
    await expect(client.stopSession(sessionId)).resolves.toEqual({ ok: true });

    client.dispose();
    serverTransport.close();
  });

  it('rejects control calls on request.failed', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    const outcome: PermissionOutcome = { outcome: 'selected', optionId: 'reject' };
    await client.connect();
    await serverTransport.connect();

    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      if (p.kind === 'agent.input') {
        serverTransport.send(
          createWireMessage({
            kind: 'request.failed',
            replyTo: p.clientReqId,
            message: 'permission request is no longer pending',
          }),
        );
      }
    });

    await expect(client.respondPermission(sessionId, 'perm-1', outcome)).rejects.toThrow(
      'permission request is no longer pending',
    );

    client.dispose();
    serverTransport.close();
  });
});

function successFor(payload: WirePayload): WirePayload | undefined {
  if (payload.kind !== 'agent.input' && payload.kind !== 'session.stop') return undefined;
  return {
    kind: 'request.succeeded',
    replyTo: payload.clientReqId,
  };
}
