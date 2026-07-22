import type { SessionId, ValidatedWireMessage } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { Hub } from '../hub';
import type { Transport, Unsubscribe } from '../transport';
import { createWireMessage, Listeners } from '../transport';

class FakeConn implements Transport {
  readonly sent: ValidatedWireMessage[] = [];
  private readonly inbound = new Listeners<ValidatedWireMessage>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: ValidatedWireMessage): void {
    this.sent.push(msg);
  }

  onMessage(cb: (msg: ValidatedWireMessage) => void): Unsubscribe {
    return this.inbound.add(cb);
  }

  onClose(): Unsubscribe {
    return noop;
  }

  close = noop;

  /** Simulate the client sending a message into the hub. */
  emit(msg: ValidatedWireMessage): void {
    this.inbound.emit(msg);
  }
}

const S1 = 's1' as SessionId;
const S2 = 's2' as SessionId;

function agentEvent(sessionId: SessionId): ValidatedWireMessage {
  return createWireMessage({
    kind: 'agent.event',
    sessionId,
    event: { type: 'status', status: 'running' },
  });
}

function streamFrame(sessionId: SessionId): ValidatedWireMessage {
  return createWireMessage({
    kind: 'simulator.stream.frame',
    sessionId,
    udid: 'U-1',
    data: 'AAA=',
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

  it('scopes simulator.stream.frame to attached sessions (never a global broadcast)', () => {
    const hub = new Hub();
    const scoped = new FakeConn();
    const normal = new FakeConn();
    hub.addConnection(scoped);
    hub.addConnection(normal);

    scoped.emit(
      createWireMessage({ kind: 'subscription.set', clientReqId: 'r1', mode: 'attached' }),
    );
    scoped.emit(createWireMessage({ kind: 'session.attach', sessionId: S1 }));

    hub.send(streamFrame(S1));
    hub.send(streamFrame(S2));

    // Scoped connection: the subscription ack plus only its attached session's frame.
    expect(scoped.sent.map((m) => m.payload.kind)).toEqual([
      'request.succeeded',
      'simulator.stream.frame',
    ]);
    // A default (mode 'all') connection still receives both frames.
    expect(normal.sent.map((m) => m.payload.kind)).toEqual([
      'simulator.stream.frame',
      'simulator.stream.frame',
    ]);
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
    const forwarded: ValidatedWireMessage[] = [];
    hub.onMessage((msg) => forwarded.push(msg));

    conn.emit(createWireMessage({ kind: 'subscription.set', clientReqId: 'r9', mode: 'all' }));
    conn.emit(createWireMessage({ kind: 'session.attach', sessionId: S1 }));

    expect(forwarded.map((m) => m.payload.kind)).toEqual(['session.attach']);
    expect(conn.sent).toHaveLength(1);
    const reply = conn.sent[0];
    expect(reply.payload.kind).toBe('request.succeeded');
    if (reply.payload.kind === 'request.succeeded') expect(reply.payload.replyTo).toBe('r9');
  });

  it('directs correlated replies to the request origin', () => {
    const hub = new Hub();
    const requester = new FakeConn();
    const observer = new FakeConn();
    hub.addConnection(requester);
    hub.addConnection(observer);

    requester.emit(createWireMessage({ kind: 'session.list', clientReqId: 'r1' }));
    hub.send(createWireMessage({ kind: 'session.listed', replyTo: 'r1', sessions: [] }));

    expect(requester.sent.map((m) => m.payload.kind)).toEqual(['session.listed']);
    expect(observer.sent).toEqual([]);
  });

  it('answers ping on its connection without forwarding it to the host', () => {
    const hub = new Hub();
    const conn = new FakeConn();
    const forwarded: ValidatedWireMessage[] = [];
    hub.addConnection(conn);
    hub.onMessage((msg) => forwarded.push(msg));

    conn.emit(createWireMessage({ kind: 'ping' }));

    expect(conn.sent.map((m) => m.payload.kind)).toEqual(['pong']);
    expect(forwarded).toEqual([]);
  });
});

const attachmentA = { attachmentId: 'attachment-a', attachmentSecret: 'a'.repeat(32) };
const attachmentB = { attachmentId: 'attachment-b', attachmentSecret: 'b'.repeat(32) };

function terminalMetadata(terminalId: string) {
  return {
    terminalId,
    cols: 80,
    rows: 24,
    managed: false,
    createdAt: 1,
    controllerAttachmentId: attachmentA.attachmentId,
  };
}

describe('Hub terminal routing', () => {
  it('routes terminal frames only to attached connections', () => {
    const hub = new Hub();
    const desktop = new FakeConn();
    const mobile = new FakeConn();
    const observer = new FakeConn();
    hub.addConnection(desktop);
    hub.addConnection(mobile);
    hub.addConnection(observer);

    desktop.emit(
      createWireMessage({
        kind: 'terminal.open',
        clientReqId: 'open-a',
        opts: { cols: 80, rows: 24 },
        ...attachmentA,
      }),
    );
    hub.send(
      createWireMessage({
        kind: 'terminal.opened',
        replyTo: 'open-a',
        terminal: terminalMetadata('term-1'),
        replay: [],
        cutoffSeq: 0,
        truncated: false,
      }),
    );
    hub.send(
      createWireMessage({ kind: 'terminal.output', terminalId: 'term-1', seq: 1, data: '$ ' }),
    );

    mobile.emit(
      createWireMessage({
        kind: 'terminal.attach',
        clientReqId: 'attach-b',
        terminalId: 'term-1',
        mode: 'view',
        ...attachmentB,
      }),
    );
    hub.send(
      createWireMessage({
        kind: 'terminal.attached',
        replyTo: 'attach-b',
        terminal: terminalMetadata('term-1'),
        replay: [{ type: 'write', seq: 1, data: '$ ' }],
        cutoffSeq: 1,
        truncated: false,
      }),
    );
    hub.send(
      createWireMessage({
        kind: 'terminal.controller.changed',
        terminalId: 'term-1',
        controllerAttachmentId: attachmentB.attachmentId,
      }),
    );

    expect(desktop.sent.map((m) => m.payload.kind)).toEqual([
      'terminal.opened',
      'terminal.output',
      'terminal.controller.changed',
    ]);
    expect(mobile.sent.map((m) => m.payload.kind)).toEqual([
      'terminal.attached',
      'terminal.controller.changed',
    ]);
    expect(observer.sent).toEqual([]);
  });

  it('detaches every attachment when its connection closes', () => {
    const hub = new Hub();
    const conn = new FakeConn();
    const forwarded: ValidatedWireMessage[] = [];
    hub.addConnection(conn);
    hub.onMessage((msg) => forwarded.push(msg));
    conn.emit(
      createWireMessage({
        kind: 'terminal.attach',
        clientReqId: 'attach-a',
        terminalId: 'term-1',
        mode: 'control',
        ...attachmentA,
      }),
    );
    hub.send(
      createWireMessage({
        kind: 'terminal.attached',
        replyTo: 'attach-a',
        terminal: terminalMetadata('term-1'),
        replay: [],
        cutoffSeq: 0,
        truncated: false,
      }),
    );
    forwarded.length = 0;

    hub.removeConnection(conn);

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.payload).toEqual({
      kind: 'terminal.detach',
      terminalId: 'term-1',
      ...attachmentA,
    });
  });

  it('tombstones a disconnected request id and detaches its late terminal', () => {
    const hub = new Hub();
    const conn = new FakeConn();
    const replacement = new FakeConn();
    const forwarded: ValidatedWireMessage[] = [];
    hub.addConnection(conn);
    hub.onMessage((msg) => forwarded.push(msg));
    conn.emit(
      createWireMessage({
        kind: 'terminal.open',
        clientReqId: 'open-late',
        opts: { cols: 80, rows: 24 },
        ...attachmentA,
      }),
    );
    hub.removeConnection(conn);
    hub.addConnection(replacement);
    forwarded.length = 0;
    replacement.emit(
      createWireMessage({
        kind: 'terminal.open',
        clientReqId: 'open-late',
        opts: { cols: 80, rows: 24 },
        ...attachmentB,
      }),
    );

    hub.send(
      createWireMessage({
        kind: 'terminal.opened',
        replyTo: 'open-late',
        terminal: terminalMetadata('term-late'),
        replay: [],
        cutoffSeq: 0,
        truncated: false,
      }),
    );

    expect(replacement.sent.map((m) => m.payload)).toEqual([
      { kind: 'request.failed', replyTo: 'open-late', message: 'duplicate clientReqId' },
    ]);
    expect(forwarded.map((m) => m.payload)).toEqual([
      { kind: 'terminal.detach', terminalId: 'term-late', ...attachmentA },
    ]);
  });
});
