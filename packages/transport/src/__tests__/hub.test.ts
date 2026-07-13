import type { SessionId, WireMessage } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { Hub } from '../hub';
import type { Transport, Unsubscribe } from '../transport';
import { createWireMessage, Listeners } from '../transport';

class FakeConn implements Transport {
  readonly sent: WireMessage[] = [];
  private readonly inbound = new Listeners<WireMessage>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: WireMessage): void {
    this.sent.push(msg);
  }

  onMessage(cb: (msg: WireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(): Unsubscribe {
    return noop;
  }

  close = noop;

  /** Simulate the client sending a message into the hub. */
  emit(msg: WireMessage): void {
    this.inbound.emit(msg);
  }
}

const S1 = 's1' as SessionId;
const S2 = 's2' as SessionId;

function agentEvent(sessionId: SessionId): WireMessage {
  return createWireMessage({
    kind: 'agent.event',
    sessionId,
    event: { type: 'status', status: 'running' },
  });
}

describe('Hub subscriptions', () => {
  it('broadcasts agent.event to every connection by default', () => {
    const hub = new Hub();
    const a = new FakeConn();
    const b = new FakeConn();
    hub.addConnection(a);
    hub.addConnection(b);
    hub.send(agentEvent(S1));
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('narrows agent.event delivery to attached sessions once mode is "attached"', () => {
    const hub = new Hub();
    const scoped = new FakeConn();
    const normal = new FakeConn();
    hub.addConnection(scoped);
    hub.addConnection(normal);

    scoped.emit(
      createWireMessage({ kind: 'subscription.set', clientReqId: 'r1', mode: 'attached' }),
    );
    scoped.emit(createWireMessage({ kind: 'session.attach', sessionId: S1 }));

    hub.send(agentEvent(S1));
    hub.send(agentEvent(S2));

    // The scoped connection got the subscription ack plus only the attached session's event.
    const scopedKinds = scoped.sent.map((m) => m.payload.kind);
    expect(scopedKinds).toEqual(['request.succeeded', 'agent.event']);
    const event = scoped.sent[1];
    if (event.payload.kind === 'agent.event') expect(event.payload.sessionId).toBe(S1);
    // The default connection still sees everything.
    expect(normal.sent.map((m) => m.payload.kind)).toEqual(['agent.event', 'agent.event']);
  });

  it('session.detach removes a session from a scoped subscription', () => {
    const hub = new Hub();
    const scoped = new FakeConn();
    hub.addConnection(scoped);
    scoped.emit(
      createWireMessage({ kind: 'subscription.set', clientReqId: 'r1', mode: 'attached' }),
    );
    scoped.emit(createWireMessage({ kind: 'session.attach', sessionId: S1 }));
    scoped.emit(createWireMessage({ kind: 'session.detach', sessionId: S1 }));
    hub.send(agentEvent(S1));
    expect(scoped.sent.map((m) => m.payload.kind)).toEqual(['request.succeeded']);
  });

  it('answers subscription.set at the hub without forwarding it to the host', () => {
    const hub = new Hub();
    const conn = new FakeConn();
    hub.addConnection(conn);
    const forwarded: WireMessage[] = [];
    hub.onMessage((msg) => forwarded.push(msg));

    conn.emit(createWireMessage({ kind: 'subscription.set', clientReqId: 'r9', mode: 'all' }));
    conn.emit(createWireMessage({ kind: 'session.attach', sessionId: S1 }));

    expect(forwarded.map((m) => m.payload.kind)).toEqual(['session.attach']);
    expect(conn.sent).toHaveLength(1);
    const reply = conn.sent[0];
    expect(reply.payload.kind).toBe('request.succeeded');
    if (reply.payload.kind === 'request.succeeded') expect(reply.payload.replyTo).toBe('r9');
  });

  it('still broadcasts non-event payloads to scoped connections', () => {
    const hub = new Hub();
    const scoped = new FakeConn();
    hub.addConnection(scoped);
    scoped.emit(
      createWireMessage({ kind: 'subscription.set', clientReqId: 'r1', mode: 'attached' }),
    );
    hub.send(createWireMessage({ kind: 'session.listed', replyTo: 'x', sessions: [] }));
    expect(scoped.sent.map((m) => m.payload.kind)).toEqual(['request.succeeded', 'session.listed']);
  });
});
