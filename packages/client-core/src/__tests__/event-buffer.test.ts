import type { AgentEvent, MessageId, SessionId, WirePayload } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../client';

const sessionId = 'sess-events' as SessionId;

function chunk(text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: 'm1' as MessageId,
    content: { type: 'text', text },
  };
}

async function connectedPair() {
  const [clientTransport, serverTransport] = createLocalTransportPair();
  const client = new LinkCodeClient(clientTransport);
  await client.connect();
  await serverTransport.connect();
  // The local pair delivers on a microtask; yield one so the client has routed the event.
  const emit = async (event: AgentEvent, id: SessionId = sessionId) => {
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId: id, event }));
    await Promise.resolve();
  };
  return { client, serverTransport, emit };
}

describe('LinkCodeClient event buffer snapshots', () => {
  it('returns a stable snapshot that only changes when an event arrives', async () => {
    const { client, serverTransport, emit } = await connectedPair();

    expect(client.getEvents(sessionId)).toBe(client.getEvents('sess-other' as SessionId));
    expect(client.getEvents(sessionId)).toEqual([]);

    await emit(chunk('a'));
    const afterFirst = client.getEvents(sessionId);
    expect(afterFirst).toEqual([chunk('a')]);
    expect(client.getEvents(sessionId)).toBe(afterFirst);

    await emit(chunk('b'));
    const afterSecond = client.getEvents(sessionId);
    expect(afterSecond).not.toBe(afterFirst);
    expect(afterSecond).toEqual([chunk('a'), chunk('b')]);
    // The earlier snapshot is untouched — appends replace the array instead of mutating it.
    expect(afterFirst).toEqual([chunk('a')]);

    client.dispose();
    serverTransport.close();
  });

  it('replays the buffer on subscribe and keeps notifying afterwards', async () => {
    const { client, serverTransport, emit } = await connectedPair();

    await emit(chunk('a'));
    await emit(chunk('b'));

    const seen: AgentEvent[] = [];
    client.subscribe(sessionId, (event) => seen.push(event));
    expect(seen).toEqual([chunk('a'), chunk('b')]);

    await emit(chunk('c'));
    expect(seen).toHaveLength(3);
    expect(client.getEvents(sessionId)).toEqual(seen);

    client.dispose();
    serverTransport.close();
  });

  it('retains the buffer and subscriptions across stopSession', async () => {
    const { client, serverTransport, emit } = await connectedPair();

    serverTransport.onMessage((msg) => {
      if (msg.payload.kind === 'session.stop') {
        const payload: WirePayload = {
          kind: 'request.succeeded',
          replyTo: msg.payload.clientReqId,
        };
        serverTransport.send(createWireMessage(payload));
      }
    });

    await emit(chunk('a'));
    const seen: AgentEvent[] = [];
    client.subscribe(sessionId, (event) => seen.push(event));

    await client.stopSession(sessionId);
    expect(client.getEvents(sessionId)).toEqual([chunk('a')]);

    // A resumed session keeps the same id; events must still reach the live subscriber.
    await emit(chunk('b'));
    expect(seen).toEqual([chunk('a'), chunk('b')]);

    client.dispose();
    serverTransport.close();
  });
});
