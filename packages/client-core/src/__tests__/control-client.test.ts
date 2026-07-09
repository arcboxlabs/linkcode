import type {
  AgentEvent,
  PermissionOutcome,
  SessionId,
  SessionNotification,
  WirePayload,
} from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import type { SequencedAgentEvent } from '../client';
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
    await expect(client.deleteSession(sessionId)).resolves.toEqual({ ok: true });

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

describe('LinkCodeClient session notifications', () => {
  it('fans session.notification broadcasts out to subscribers until unsubscribed', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    await client.connect();
    await serverTransport.connect();

    const seen: SessionNotification[] = [];
    const unsubscribe = client.subscribeSessionNotification((n) => seen.push(n));
    const notification: SessionNotification = {
      sessionId,
      kind: 'claude-code',
      cwd: '/repo',
      title: 'Fix the flaky test',
      reason: { type: 'turn-completed', stopReason: 'end_turn' },
    };
    serverTransport.send(createWireMessage({ kind: 'session.notification', notification }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(seen).toEqual([notification]);

    unsubscribe();
    serverTransport.send(createWireMessage({ kind: 'session.notification', notification }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(seen).toHaveLength(1);

    client.dispose();
    serverTransport.close();
  });
});

describe('LinkCodeClient event buffer', () => {
  it('sequences received events and replays them to a late subscriber with original seqs', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    await client.connect();
    await serverTransport.connect();

    const first: AgentEvent = { type: 'user-message', content: [{ type: 'text', text: 'hi' }] };
    const second: AgentEvent = { type: 'status', status: 'running' };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event: first }));
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event: second }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    expect(client.eventSeq(sessionId)).toBe(2);

    // A late subscriber replays the buffer with the original seqs, not renumbered ones.
    const seen: Array<Pick<SequencedAgentEvent, 'event' | 'seq'>> = [];
    client.subscribe(sessionId, (event, seq) => seen.push({ event, seq }));
    expect(seen).toEqual([
      { event: first, seq: 1 },
      { event: second, seq: 2 },
    ]);

    client.dispose();
    serverTransport.close();
  });

  it('serves a stable events snapshot between changes and a fresh one per event', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    await client.connect();
    await serverTransport.connect();

    expect(client.eventsSnapshot(sessionId)).toBe(client.eventsSnapshot(sessionId));
    expect(client.eventsSnapshot(sessionId)).toEqual([]);

    const event: AgentEvent = { type: 'status', status: 'running' };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });

    const snapshot = client.eventsSnapshot(sessionId);
    expect(snapshot).toEqual([{ event, seq: 1, receivedAt: expect.any(Number) as number }]);
    // Identity is stable until the next event — the useSyncExternalStore contract.
    expect(client.eventsSnapshot(sessionId)).toBe(snapshot);

    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(client.eventsSnapshot(sessionId)).not.toBe(snapshot);
    expect(client.eventsSnapshot(sessionId)).toHaveLength(2);

    client.dispose();
    serverTransport.close();
  });

  it('keeps the seq counter monotone across a stop that clears the buffer', async () => {
    const [clientTransport, serverTransport] = createLocalTransportPair();
    const client = new LinkCodeClient(clientTransport);
    await client.connect();
    await serverTransport.connect();

    serverTransport.onMessage((msg) => {
      const payload = successFor(msg.payload);
      if (payload) serverTransport.send(createWireMessage(payload));
    });

    const event: AgentEvent = { type: 'status', status: 'running' };
    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    await client.stopSession(sessionId);

    serverTransport.send(createWireMessage({ kind: 'agent.event', sessionId, event }));
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
    // Were the counter reset with the buffer, a pre-stop uptoSeq would swallow this event.
    expect(client.eventSeq(sessionId)).toBe(2);
    const seen: Array<Pick<SequencedAgentEvent, 'event' | 'seq'>> = [];
    client.subscribe(sessionId, (e, seq) => seen.push({ event: e, seq }));
    expect(seen).toEqual([{ event, seq: 2 }]);

    client.dispose();
    serverTransport.close();
  });
});

function successFor(payload: WirePayload): WirePayload | undefined {
  if (
    payload.kind !== 'agent.input' &&
    payload.kind !== 'session.stop' &&
    payload.kind !== 'session.delete'
  ) {
    return undefined;
  }
  return {
    kind: 'request.succeeded',
    replyTo: payload.clientReqId,
  };
}
