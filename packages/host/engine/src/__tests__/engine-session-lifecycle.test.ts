import type { AgentInput, StartOptions } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import type { SessionStore } from '../session/session-store';
import { InMemorySessionStore } from '../session/session-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  listedSessions,
  startedSessionId as startedId,
  settleEngineTasks as tick,
} from './fixtures/session-harness';

/** An adapter whose start() blocks until the test releases it, to interleave other requests. */
class GatedStartAdapter extends FakeAdapter {
  releaseStart: () => void = noop;

  override start(opts: StartOptions): Promise<void> {
    this.startedWith = opts;
    return new Promise((resolve) => {
      this.releaseStart = resolve;
    });
  }
}

class GatedSendAndStopAdapter extends FakeAdapter {
  releaseSend: () => void = noop;
  releaseStop: () => void = noop;
  stopStarted = false;

  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return new Promise((resolve) => {
      this.releaseSend = resolve;
    });
  }

  override stop(): Promise<void> {
    this.stopStarted = true;
    return new Promise((resolve) => {
      this.releaseStop = () => {
        this.stopped = true;
        resolve();
      };
    });
  }
}

class RejectingStopAdapter extends FakeAdapter {
  override stop(): Promise<void> {
    this.stopped = true;
    return Promise.reject(new Error('adapter stop failed'));
  }
}

describe('engine session lifecycle', () => {
  it('deletes a live session: stops the adapter and drops the record', async () => {
    const store = new InMemorySessionStore();
    const { engine, sent, inject, adapters } = harness(store);
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(sent, 'r1');
    await inject({ kind: 'session.delete', clientReqId: 'r2', sessionId });

    expect(sent.some((p) => p.kind === 'request.succeeded' && p.replyTo === 'r2')).toBe(true);
    expect(adapters[0].stopped).toBe(true);
    expect(await store.load()).toHaveLength(0);
    await inject({ kind: 'session.list', clientReqId: 'r3' });
    expect(listedSessions(sent, 'r3')).toHaveLength(0);
  });

  it('deletes a cold session idempotently instead of failing with "Unknown session"', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');

    // A fresh engine over the same store: the session is cold, with no live adapter to stop.
    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.delete', clientReqId: 'r2', sessionId });
    expect(second.sent.some((p) => p.kind === 'request.succeeded' && p.replyTo === 'r2')).toBe(
      true,
    );
    expect(await store.load()).toHaveLength(0);

    // Deleting again (e.g. from a second attached client) still succeeds.
    await second.inject({ kind: 'session.delete', clientReqId: 'r3', sessionId });
    expect(second.sent.some((p) => p.kind === 'request.succeeded' && p.replyTo === 'r3')).toBe(
      true,
    );
  });

  it('deleting a session cancels its pending start without reporting a request failure', async () => {
    const store = new InMemorySessionStore();
    const { engine, sent, inject, adapters } = harness(store, () => new GatedStartAdapter());
    await engine.start();
    // The handler suspends inside adapter.start(); the session is already registered by then.
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const [record] = await store.load();
    await inject({ kind: 'session.delete', clientReqId: 'r2', sessionId: record.sessionId });
    expect(sent.some((p) => p.kind === 'request.succeeded' && p.replyTo === 'r2')).toBe(true);

    const adapter = adapters[0] as GatedStartAdapter;
    expect(adapter.stopped).toBe(true);

    adapter.releaseStart();
    await tick();
    expect(sent.some((p) => p.kind === 'session.started' && p.replyTo === 'r1')).toBe(false);
    expect(sent.some((p) => p.kind === 'request.failed' && p.replyTo === 'r1')).toBe(false);
    expect(await store.load()).toHaveLength(0);
  });

  it('stopping a session cancels its pending input and waits for the adapter to stop', async () => {
    const h = harness(new InMemorySessionStore(), () => new GatedSendAndStopAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = h.adapters[0] as GatedSendAndStopAdapter;
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'input',
      sessionId,
      input: { type: 'prompt', content: [{ type: 'text', text: 'Hello' }] },
    });

    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId });
    expect(adapter.stopStarted).toBe(true);
    expect(h.sent.some((p) => p.kind === 'request.succeeded' && p.replyTo === 'stop')).toBe(false);

    adapter.releaseStop();
    await tick();
    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'stop' });

    adapter.releaseSend();
    await tick();
    expect(h.sent.some((p) => p.kind === 'request.succeeded' && p.replyTo === 'input')).toBe(false);
    expect(h.sent.some((p) => p.kind === 'request.failed' && p.replyTo === 'input')).toBe(false);
  });

  it('keeps the session listed when the persisted delete fails', async () => {
    const inner = new InMemorySessionStore();
    const failingStore: SessionStore = {
      load: () => inner.load(),
      save: (record) => inner.save(record),
      delete: () => Promise.reject(new Error('disk unavailable')),
    };
    const { engine, sent, inject } = harness(failingStore);
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(sent, 'r1');
    await inject({ kind: 'session.delete', clientReqId: 'r2', sessionId });

    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r2',
      code: 'operation_failed',
      message: 'Failed to delete session record',
    });
    expect(sent.some((payload) => JSON.stringify(payload).includes('disk unavailable'))).toBe(
      false,
    );
    // The live adapter was stopped, but the record must stay listed (cold) — not half-deleted.
    await inject({ kind: 'session.list', clientReqId: 'r3' });
    const sessions = listedSessions(sent, 'r3');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('stopped');
  });

  it('wakes a never-prompted session (no provider linkage) as a fresh start under the same id', async () => {
    const { engine, sent, inject, adapters } = harness();
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(sent, 'r1');
    await inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });
    await inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });

    expect(startedId(sent, 'r3')).toBe(sessionId);
    const resumed = adapters.at(-1);
    expect(resumed?.resumedFrom).toBeNull();
    expect(resumed?.startedWith).toMatchObject({ kind: 'claude-code', cwd: '/repo' });
  });

  it('removes and seals a stopped binding even when adapter.stop rejects', async () => {
    const h = harness(new InMemorySessionStore(), () => new RejectingStopAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    await h.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r2',
      code: 'operation_failed',
      message: 'Agent failed to stop',
    });
    const [record] = await h.store.load();
    expect(record.runs.at(-1)?.endedAt).toBeTypeOf('number');
    await h.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    expect(startedId(h.sent, 'r3')).toBe(sessionId);
  });
});
