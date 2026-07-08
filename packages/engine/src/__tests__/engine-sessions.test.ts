import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import { AUTH_FAILED_ERROR_CODE, asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  AgentInput,
  AgentRuntimes,
  SessionId,
  StartOptions,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../engine';
import type { SessionStore } from '../session-store';
import { InMemorySessionStore } from '../session-store';

class FakeAdapter implements AgentAdapter {
  readonly kind = 'claude-code' as const;
  readonly historyCapabilities: AgentHistoryCapabilities = {
    list: false,
    read: true,
    resume: true,
  };

  startedWith: StartOptions | null = null;
  resumedFrom: string | null = null;
  stopped = false;
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  start(opts: StartOptions): Promise<void> {
    this.startedWith = opts;
    return Promise.resolve();
  }

  listHistory(): Promise<AgentHistoryListResult> {
    return Promise.resolve({ sessions: [] });
  }

  readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return Promise.resolve({
      session: {
        historyId: opts.historyId,
        kind: this.kind,
        title: 'Imported title',
        cwd: '/imported',
        createdAt: 1111,
      },
      events: [],
    });
  }

  resumeHistory(opts: AgentHistoryResumeOptions): Promise<void> {
    this.resumedFrom = opts.historyId;
    return Promise.resolve();
  }

  send(_input: AgentInput): Promise<void> {
    return Promise.resolve();
  }

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }

  emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}

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

/** An adapter whose send() blocks until released, to interleave an attach with an in-flight response. */
class GatedSendAdapter extends FakeAdapter {
  releaseSend: () => void = noop;

  override send(_input: AgentInput): Promise<void> {
    return new Promise((resolve) => {
      this.releaseSend = resolve;
    });
  }
}

/** Let the fire-and-forget handle()/persist chains settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function harness(
  store: SessionStore = new InMemorySessionStore(),
  makeAdapter: () => FakeAdapter = () => new FakeAdapter(),
  collectAgentRuntimes?: () => Promise<AgentRuntimes>,
) {
  const sent: WirePayload[] = [];
  let handler: ((msg: WireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const adapters: FakeAdapter[] = [];
  const factory: AdapterFactory = () => {
    const adapter = makeAdapter();
    adapters.push(adapter);
    return adapter;
  };
  const engine = new Engine(transport, { factory, sessionStore: store, collectAgentRuntimes });

  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    await tick();
  }

  return { engine, sent, inject, adapters, store };
}

function startedId(sent: WirePayload[], replyTo: string): SessionId {
  const started = sent.find((p) => p.kind === 'session.started' && p.replyTo === replyTo);
  if (started?.kind !== 'session.started') throw new Error(`no session.started for ${replyTo}`);
  return started.sessionId;
}

function listedSessions(sent: WirePayload[], replyTo: string) {
  const listed = sent.find((p) => p.kind === 'session.listed' && p.replyTo === replyTo);
  if (listed?.kind !== 'session.listed') throw new Error(`no session.listed for ${replyTo}`);
  return listed.sessions;
}

describe('engine session persistence', () => {
  it('persists created sessions with title and session-ref, and lists them cold after a restart', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'prompt', content: [textBlock('  Fix the   flaky\ntest  ')] },
    });

    const records = await store.load();
    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe(sessionId);
    expect(records[0].origin).toEqual({ type: 'created' });
    expect(records[0].title).toBe('Fix the flaky test');
    expect(records[0].runs).toHaveLength(1);
    expect(records[0].runs[0].historyId).toBe('native-1');

    // A fresh engine over the same store lists the session cold.
    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.list', clientReqId: 'r3' });
    const sessions = listedSessions(second.sent, 'r3');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      status: 'stopped',
      title: 'Fix the flaky test',
      cwd: '/repo',
      historyId: 'native-1',
    });
    expect(sessions[0].updatedAt).toBeTypeOf('number');
  });

  it('resumes a persisted session under the same id, appending a run', async () => {
    const store = new InMemorySessionStore();
    const first = harness(store);
    await first.engine.start();
    await first.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(first.sent, 'r1');
    first.adapters[0].emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    await first.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    const second = harness(store);
    await second.engine.start();
    await second.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    expect(startedId(second.sent, 'r3')).toBe(sessionId);
    expect(second.adapters[0].resumedFrom).toBe('native-1');

    const [record] = await store.load();
    expect(record.runs).toHaveLength(2);
    expect(record.runs[0].endedAt).toBeTypeOf('number');
    expect(record.runs[1].historyId).toBe('native-1');
  });

  it('imports a provider history session as a cold record', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    await inject({
      kind: 'session.import',
      clientReqId: 'r1',
      agentKind: 'claude-code',
      historyId: asHistoryId('native-9'),
    });

    const imported = sent.find((p) => p.kind === 'session.imported');
    if (imported?.kind !== 'session.imported') throw new Error('no session.imported reply');
    expect(imported.record).toMatchObject({
      kind: 'claude-code',
      cwd: '/imported',
      title: 'Imported title',
      origin: { type: 'imported', historyId: 'native-9' },
      createdAt: 1111,
      runs: [],
    });

    await inject({ kind: 'session.list', clientReqId: 'r2' });
    expect(listedSessions(sent, 'r2')[0].status).toBe('stopped');
  });

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

  it('fails the start instead of leaking the adapter when deleted while starting', async () => {
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

    (adapters[0] as GatedStartAdapter).releaseStart();
    await tick();
    expect(sent.some((p) => p.kind === 'session.started' && p.replyTo === 'r1')).toBe(false);
    const failed = sent.find((p) => p.kind === 'request.failed' && p.replyTo === 'r1');
    if (failed?.kind !== 'request.failed') throw new Error('no request.failed for r1');
    expect(failed.message).toContain('closed while starting');
    expect(adapters[0].stopped).toBe(true);
    expect(await store.load()).toHaveLength(0);
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

    expect(sent.some((p) => p.kind === 'request.failed' && p.replyTo === 'r2')).toBe(true);
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
});

describe('engine attach replay', () => {
  const QUESTION_ASK: AgentEvent = {
    type: 'question-request',
    requestId: 'ask-1',
    toolCall: { toolCallId: 't1', title: 'AskUserQuestion' },
    questions: [
      {
        questionId: 'q0',
        prompt: 'Which one?',
        multiSelect: false,
        options: [
          { optionId: 'o0', label: 'A' },
          { optionId: 'o1', label: 'B' },
        ],
      },
    ],
  };
  const PERMISSION_ASK: AgentEvent = {
    type: 'permission-request',
    requestId: 'perm-1',
    toolCall: { toolCallId: 't2', title: 'Run' },
    options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
  };

  function eventsAfter(sent: WirePayload[], mark: number): AgentEvent[] {
    return sent.slice(mark).flatMap((p) => (p.kind === 'agent.event' ? [p.event] : []));
  }

  async function startedHarness() {
    const h = harness();
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    return { ...h, sessionId: startedId(h.sent, 'r1'), adapter: nullthrow(h.adapters[0]) };
  }

  it('replays the live status and open asks to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);
    adapter.emit(QUESTION_ASK);

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const replayed = eventsAfter(sent, mark);
    expect(replayed[0]).toEqual({ type: 'status', status: 'running' });
    expect(replayed).toContainEqual(PERMISSION_ASK);
    expect(replayed).toContainEqual(QUESTION_ASK);
  });

  it('stops replaying an ask once its response arrived', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);
    await inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: {
        type: 'question-response',
        requestId: 'ask-1',
        outcome: { outcome: 'cancelled' },
      },
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(sent, mark).some((e) => e.type === 'question-request')).toBe(false);
  });

  it('stops replaying an ask while its response send is still in flight', async () => {
    const h = harness(new InMemorySessionStore(), () => new GatedSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]) as GatedSendAdapter;

    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);
    // The response's send() blocks; the handler is suspended past the point where the ask is cleared.
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });

    const mark = h.sent.length;
    await h.inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(h.sent, mark).some((e) => e.type === 'question-request')).toBe(false);

    adapter.releaseSend();
  });

  it('stops replaying an ask once its tool call settled', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);
    adapter.emit({
      type: 'tool-call',
      toolCall: {
        toolCallId: 't1',
        title: 'AskUserQuestion',
        kind: 'other',
        status: 'failed',
        content: [],
      },
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(sent, mark).some((e) => e.type === 'question-request')).toBe(false);
  });

  it('clears open asks at a turn boundary (idle)', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);
    adapter.emit({ type: 'status', status: 'idle' });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const replayed = eventsAfter(sent, mark);
    expect(replayed[0]).toEqual({ type: 'status', status: 'idle' });
    expect(replayed.some((e) => e.type === 'permission-request')).toBe(false);
  });
});

describe('auth-failure re-probe', () => {
  it('re-probes runtimes on an authentication-failure error, but not on other errors', async () => {
    const signedOut: AgentRuntimes = {
      'claude-code': { status: 'available', source: 'detected', auth: { loggedIn: false } },
    };
    const collect = vi.fn(() => Promise.resolve(signedOut));
    const { engine, sent, inject, adapters } = harness(undefined, undefined, collect);
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const adapter = nullthrow(adapters[0], 'no adapter started');

    adapter.emit({
      type: 'error',
      message: 'Claude authentication failed',
      code: AUTH_FAILED_ERROR_CODE,
      recoverable: false,
    });
    await tick();
    expect(collect).toHaveBeenCalledOnce();
    expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: signedOut });

    // A generic (non-auth) error must not trigger a re-probe.
    adapter.emit({ type: 'error', message: 'boom', recoverable: true });
    await tick();
    expect(collect).toHaveBeenCalledOnce();
  });
});
