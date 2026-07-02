import type { AgentEvent, PermissionOutcome, SessionId, WirePayload } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import type { TimedAgentEvent } from '../client';
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

describe('LinkCodeClient event buffer', () => {
  it('replays buffered events to a late subscriber with their original receive times', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    await client.connect();
    await serverTransport.connect();

    const event: AgentEvent = { type: 'user-message', content: [{ type: 'text', text: 'hi' }] };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    const seen: TimedAgentEvent[] = [];
    client.subscribe(sessionId, (e, at) => seen.push({ event: e, at }));
    expect(seen).toHaveLength(1);
    expect(seen[0].event).toEqual(event);
    const receivedAt = seen[0].at;
    expect(receivedAt).toBeLessThanOrEqual(Date.now());

    // A second subscriber sees the same receive time, not the replay time.
    const replayed: TimedAgentEvent[] = [];
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    client.subscribe(sessionId, (e, at) => replayed.push({ event: e, at }));
    expect(replayed[0].at).toBe(receivedAt);

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
