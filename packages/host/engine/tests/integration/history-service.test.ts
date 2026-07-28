import type { WireMessage, WirePayload } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { trueFn } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import {
  fakeHistoryFactory,
  historyId,
  RejectingHistoryAdapter,
  UnsupportedHistoryAdapter,
} from '../../src/__tests__/fixtures/history-adapter';
import { createTestEngine } from '../../src/__tests__/fixtures/test-engine';

describe('Engine history wire API', () => {
  it('reports unsupported history listing without an internal error', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const [clientTransport, engineTransport] = createLocalTransportPair();
    const engine = createTestEngine(engineTransport, {
      factory: (kind) => new UnsupportedHistoryAdapter(kind, state),
    });
    const received: WireMessage[] = [];
    clientTransport.onMessage((msg) => received.push(msg));
    await clientTransport.connect();
    await engine.start();

    clientTransport.send(
      createWireMessage({
        kind: 'history.list',
        clientReqId: 'list',
        agentKind: 'codex',
        opts: {},
      }),
    );

    expect(await waitForPayload(received, 'request.failed')).toEqual({
      kind: 'request.failed',
      replyTo: 'list',
      code: 'unsupported',
      message: 'codex: history list is not supported',
    });
    await engine.stop();
    clientTransport.close();
  });

  it('redacts adapter history failures behind a safe operation message', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const [clientTransport, engineTransport] = createLocalTransportPair();
    const engine = createTestEngine(engineTransport, {
      factory: (kind) => new RejectingHistoryAdapter(kind, state),
    });
    const received: WireMessage[] = [];
    clientTransport.onMessage((msg) => received.push(msg));
    await clientTransport.connect();
    await engine.start();

    clientTransport.send(
      createWireMessage({
        kind: 'history.read',
        clientReqId: 'read',
        agentKind: 'codex',
        opts: { historyId, limit: 1 },
      }),
    );

    expect(await waitForPayload(received, 'request.failed')).toEqual({
      kind: 'request.failed',
      replyTo: 'read',
      code: 'operation_failed',
      message: 'Failed to read agent history',
    });
    expect(received.some((message) => JSON.stringify(message).includes('secret provider'))).toBe(
      false,
    );
    await engine.stop();
    clientTransport.close();
  });

  it('reports unsupported history resume without starting a session', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const [clientTransport, engineTransport] = createLocalTransportPair();
    const engine = createTestEngine(engineTransport, {
      factory: (kind) => new UnsupportedHistoryAdapter(kind, state),
    });
    const received: WireMessage[] = [];
    clientTransport.onMessage((msg) => received.push(msg));
    await clientTransport.connect();
    await engine.start();

    clientTransport.send(
      createWireMessage({
        kind: 'history.resume',
        clientReqId: 'resume',
        agentKind: 'codex',
        historyId,
        startOpts: { kind: 'codex', cwd: '/repo' },
      }),
    );

    expect(await waitForPayload(received, 'request.failed')).toEqual({
      kind: 'request.failed',
      replyTo: 'resume',
      code: 'unsupported',
      message: 'codex: history resume is not supported',
    });
    expect(received.some((message) => message.payload.kind === 'session.started')).toBe(false);
    await engine.stop();
    clientTransport.close();
  });

  it('lists, reads, and resumes history over transport', async () => {
    const state = { listCalls: 0, readCalls: 0, resumeCalls: 0 };
    const [clientTransport, engineTransport] = createLocalTransportPair();
    const engine = createTestEngine(engineTransport, { factory: fakeHistoryFactory(state) });
    const received: WireMessage[] = [];

    clientTransport.onMessage((msg) => received.push(msg));
    await clientTransport.connect();
    await engine.start();

    clientTransport.send(
      createWireMessage({
        kind: 'history.list',
        clientReqId: 'list-1',
        agentKind: 'codex',
        opts: { limit: 1 },
      }),
    );
    const listed = await waitForPayload(received, 'history.listed');
    expect(listed.replyTo).toBe('list-1');
    expect(listed.result.sessions[0]?.historyId).toBe(historyId);

    clientTransport.send(
      createWireMessage({
        kind: 'history.read',
        clientReqId: 'read-1',
        agentKind: 'codex',
        opts: { historyId, limit: 1 },
      }),
    );
    const read = await waitForPayload(received, 'history.read.result');
    expect(read.replyTo).toBe('read-1');
    expect(read.result.events[0]?.itemId).toBe('u1');

    clientTransport.send(
      createWireMessage({
        kind: 'history.resume',
        clientReqId: 'resume-1',
        agentKind: 'codex',
        historyId,
        startOpts: { kind: 'codex', cwd: '/repo' },
      }),
    );
    const started = await waitForPayload(received, 'session.started');
    expect(started.replyTo).toBe('resume-1');
    expect(state.resumeCalls).toBe(1);

    clientTransport.send(
      createWireMessage({
        kind: 'agent.input',
        clientReqId: 'input-1',
        sessionId: started.sessionId,
        input: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    const inputAck = await waitForPayload(
      received,
      'request.succeeded',
      (payload) => payload.replyTo === 'input-1',
    );
    expect(inputAck.replyTo).toBe('input-1');

    clientTransport.send(
      createWireMessage({
        kind: 'session.stop',
        clientReqId: 'stop-1',
        sessionId: started.sessionId,
      }),
    );
    const stopAck = await waitForPayload(
      received,
      'request.succeeded',
      (payload) => payload.replyTo === 'stop-1',
    );
    expect(stopAck.replyTo).toBe('stop-1');

    engine.stop();
    clientTransport.close();
  });
});

function waitForPayload<K extends WirePayload['kind']>(
  messages: WireMessage[],
  kind: K,
  predicate: (payload: Extract<WirePayload, { kind: K }>) => boolean = trueFn,
): Promise<Extract<WirePayload, { kind: K }>> {
  const existing = messages.find((msg) => {
    if (msg.payload.kind !== kind) return false;
    return predicate(msg.payload as Extract<WirePayload, { kind: K }>);
  });
  if (existing) return Promise.resolve(existing.payload as Extract<WirePayload, { kind: K }>);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${kind}`)), 500);
    const poll = (): void => {
      const found = messages.find((msg) => {
        if (msg.payload.kind !== kind) return false;
        return predicate(msg.payload as Extract<WirePayload, { kind: K }>);
      });
      if (found) {
        clearTimeout(timeout);
        resolve(found.payload as Extract<WirePayload, { kind: K }>);
      } else {
        setTimeout(poll, 0);
      }
    };
    poll();
  });
}
