import { asHistoryId } from '@linkcode/agent-adapter';
import type { AgentEvent, AgentInput, StartOptions, WirePayload } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
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

/** An adapter whose send() blocks until released, to interleave an attach with an in-flight response. */
class GatedSendAdapter extends FakeAdapter {
  releaseSend: () => void = noop;
  sendCount = 0;

  override send(_input: AgentInput): Promise<void> {
    this.sendCount += 1;
    return new Promise((resolve) => {
      this.releaseSend = resolve;
    });
  }
}

class GatedRejectingSendAdapter extends FakeAdapter {
  rejectSend: () => void = noop;

  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return new Promise((_resolve, reject) => {
      this.rejectSend = () => reject(new Error('adapter rejected response'));
    });
  }
}

class RejectingStopAdapter extends FakeAdapter {
  override stop(): Promise<void> {
    this.stopped = true;
    return Promise.reject(new Error('adapter stop failed'));
  }
}

class RejectingSendAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.sentInputs.push(input);
    return Promise.reject(new Error('adapter rejected response'));
  }
}

class InvalidatingRejectingSendAdapter extends RejectingSendAdapter {
  override send(input: AgentInput): Promise<void> {
    this.emit({ type: 'status', status: 'idle' });
    return super.send(input);
  }
}

class InvalidatingSuccessfulSendAdapter extends FakeAdapter {
  override send(input: AgentInput): Promise<void> {
    this.emit({ type: 'status', status: 'idle' });
    return super.send(input);
  }
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
      message: 'Error: adapter stop failed',
    });
    const [record] = await h.store.load();
    expect(record.runs.at(-1)?.endedAt).toBeTypeOf('number');
    await h.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    expect(startedId(h.sent, 'r3')).toBe(sessionId);
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
  const QUESTION_BATCH: AgentEvent = {
    type: 'question-request',
    requestId: 'ask-batch',
    toolCall: { toolCallId: 't-batch', title: 'AskUserQuestion' },
    questions: [
      {
        questionId: 'single',
        prompt: 'Which one?',
        multiSelect: false,
        options: [
          { optionId: 'a', label: 'A' },
          { optionId: 'b', label: 'B' },
        ],
      },
      {
        questionId: 'multi',
        prompt: 'Which ones?',
        multiSelect: true,
        options: [
          { optionId: 'x', label: 'X' },
          { optionId: 'y', label: 'Y' },
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

  it('replays the latest command catalog to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'available-commands-update', commands: [{ name: 'stale' }] });
    adapter.emit({
      type: 'available-commands-update',
      commands: [{ name: 'compact', description: 'Compact the context' }],
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const catalogs = eventsAfter(sent, mark).filter((e) => e.type === 'available-commands-update');
    // Full-replace semantics: only the latest catalog is replayed.
    expect(catalogs).toEqual([
      {
        type: 'available-commands-update',
        commands: [{ name: 'compact', description: 'Compact the context' }],
      },
    ]);
  });

  it('replays the latest model catalog to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'available-models-update', models: [{ id: 'stale/old', label: 'Old' }] });
    adapter.emit({
      type: 'available-models-update',
      models: [{ id: 'openai/gpt-5-nano', label: 'GPT-5 Nano', description: 'OpenAI' }],
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const catalogs = eventsAfter(sent, mark).filter((e) => e.type === 'available-models-update');
    // Full-replace semantics: only the latest catalog is replayed.
    expect(catalogs).toEqual([
      {
        type: 'available-models-update',
        models: [{ id: 'openai/gpt-5-nano', label: 'GPT-5 Nano', description: 'OpenAI' }],
      },
    ]);
  });

  it('replays the latest adapter capabilities to an attaching client', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(sent, mark)).toContainEqual({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });
  });

  it('echoes command and shell inputs as the text the user typed', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: true },
    });
    adapter.emit({ type: 'available-commands-update', commands: [{ name: 'review' }] });
    const mark = sent.length;
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-cmd',
      sessionId,
      input: { type: 'command', name: 'review', arguments: 'src/index.ts' },
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-sh',
      sessionId,
      input: { type: 'shell-command', command: 'git status' },
    });
    const echoes = eventsAfter(sent, mark).filter((e) => e.type === 'user-message');
    expect(echoes).toEqual([
      { type: 'user-message', content: [{ type: 'text', text: '/review src/index.ts' }] },
      { type: 'user-message', content: [{ type: 'text', text: '$ git status' }] },
    ]);
  });

  it('accepts a command invoked by a catalog alias, echoing the typed alias', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });
    adapter.emit({
      type: 'available-commands-update',
      commands: [{ name: 'usage', aliases: ['cost'] }],
    });
    const mark = sent.length;
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-alias',
      sessionId,
      input: { type: 'command', name: 'cost' },
    });
    const echoes = eventsAfter(sent, mark).filter((e) => e.type === 'user-message');
    expect(echoes).toEqual([{ type: 'user-message', content: [{ type: 'text', text: '/cost' }] }]);
    expect(sent.slice(mark).some((payload) => payload.kind === 'request.failed')).toBe(false);
  });

  it('rejects unavailable command and shell inputs before echoing them', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({
      type: 'capabilities-update',
      capabilities: { slashCommands: true, shellCommand: false },
    });
    adapter.emit({ type: 'available-commands-update', commands: [{ name: 'compact' }] });
    const mark = sent.length;

    await inject({
      kind: 'agent.input',
      clientReqId: 'r-command',
      sessionId,
      input: { type: 'command', name: 'stale' },
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'r-shell',
      sessionId,
      input: { type: 'shell-command', command: 'git status' },
    });

    const rejected = sent.slice(mark);
    expect(
      rejected.some(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toBe(false);
    expect(
      rejected.filter(
        (payload) =>
          payload.kind === 'agent.event' &&
          payload.event.type === 'error' &&
          payload.event.code === 'input_rejected',
      ),
    ).toHaveLength(2);
    expect(rejected.filter((payload) => payload.kind === 'request.failed')).toHaveLength(2);
  });

  it('rejects a concurrent turn input before echoing or dispatching it', async () => {
    const h = harness(new InMemorySessionStore(), () => new GatedSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]) as GatedSendAdapter;

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r-first',
      sessionId,
      input: { type: 'prompt', content: [textBlock('first')] },
    });
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r-second',
      sessionId,
      input: { type: 'prompt', content: [textBlock('second')] },
    });

    expect(adapter.sendCount).toBe(1);
    expect(
      h.sent.filter(
        (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
      ),
    ).toHaveLength(1);
    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r-second',
      message: `Error: Session is busy: ${sessionId}`,
    });
    expect(h.sent).toContainEqual({
      kind: 'agent.event',
      sessionId,
      event: {
        type: 'error',
        message: `Session is busy: ${sessionId}`,
        code: 'input_rejected',
        recoverable: true,
      },
    });
    adapter.releaseSend();
  });

  it('replays only the authoritative resolution after a response succeeds', async () => {
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
    expect(eventsAfter(sent, mark)).toEqual([
      { type: 'status', status: 'running' },
      {
        type: 'capabilities-update',
        capabilities: { slashCommands: false, shellCommand: false },
      },
      {
        type: 'question-resolved',
        requestId: 'ask-1',
        outcome: { outcome: 'cancelled' },
        source: 'user',
      },
    ]);
  });

  it('keeps an in-flight response unresolved and rejects a concurrent response', async () => {
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
    // The first send blocks after the Engine atomically claims the ask.
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });

    const mark = h.sent.length;
    await h.inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(h.sent, mark)).toContainEqual(QUESTION_ASK);
    expect(eventsAfter(h.sent, mark)).toContainEqual({
      type: 'prompt-response-status',
      requestId: 'ask-1',
      status: 'responding',
    });
    expect(eventsAfter(h.sent, mark).some((e) => e.type === 'question-resolved')).toBe(false);

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r3',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });
    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r3',
      message: 'Error: Response already in flight: ask-1',
    });
    expect(adapter.sendCount).toBe(1);

    adapter.releaseSend();
    await tick();
    expect(eventsAfter(h.sent, mark)).toContainEqual({
      type: 'question-resolved',
      requestId: 'ask-1',
      outcome: { outcome: 'cancelled' },
      source: 'user',
    });
  });

  it('session.stop cancels open and responding asks without reopening a rejected response', async () => {
    const h = harness(new InMemorySessionStore(), () => new GatedRejectingSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]) as GatedRejectingSendAdapter;
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);
    adapter.emit(QUESTION_ASK);
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'response',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });

    const mark = h.sent.length;
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId });
    expect(eventsAfter(h.sent, mark)).toEqual([
      {
        type: 'permission-resolved',
        requestId: 'perm-1',
        outcome: { outcome: 'cancelled' },
        source: 'session',
      },
      {
        type: 'question-resolved',
        requestId: 'ask-1',
        outcome: { outcome: 'cancelled' },
        source: 'session',
      },
      { type: 'status', status: 'stopped' },
    ]);

    adapter.rejectSend();
    await tick();
    const afterClose = eventsAfter(h.sent, mark);
    expect(afterClose.filter((event) => event.type === 'question-resolved')).toHaveLength(1);
    expect(afterClose.some((event) => event.type === 'question-request')).toBe(false);
    expect(
      afterClose.some(
        (event) => event.type === 'prompt-response-status' && event.status === 'open',
      ),
    ).toBe(false);
  });

  it('session.stop during an in-flight response keeps a successful send successful', async () => {
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
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'response',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });

    const mark = h.sent.length;
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId });
    adapter.releaseSend();
    await tick();

    expect(h.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'response' });
    // The stop's session-cancellation stays the only resolution; no user-sourced duplicate follows.
    expect(eventsAfter(h.sent, mark).filter((event) => event.type === 'question-resolved')).toEqual(
      [
        {
          type: 'question-resolved',
          requestId: 'ask-1',
          outcome: { outcome: 'cancelled' },
          source: 'session',
        },
      ],
    );
  });

  it('session.delete resolves an open ask and broadcasts stopped before removal', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);

    const mark = sent.length;
    await inject({ kind: 'session.delete', clientReqId: 'delete', sessionId });
    expect(eventsAfter(sent, mark)).toEqual([
      {
        type: 'question-resolved',
        requestId: 'ask-1',
        outcome: { outcome: 'cancelled' },
        source: 'session',
      },
      { type: 'status', status: 'stopped' },
    ]);
    expect(sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'delete' });
  });

  it('restores and replays an ask when the adapter rejects its response', async () => {
    const h = harness(new InMemorySessionStore(), () => new RejectingSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]);
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);

    const mark = h.sent.length;
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });
    expect(eventsAfter(h.sent, mark)).toContainEqual(QUESTION_ASK);
    expect(eventsAfter(h.sent, mark)).toContainEqual({
      type: 'prompt-response-status',
      requestId: 'ask-1',
      status: 'open',
    });
    expect(eventsAfter(h.sent, mark).some((event) => event.type === 'question-resolved')).toBe(
      false,
    );
    expect(h.sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r2',
      message: 'Error: adapter rejected response',
    });

    const attachMark = h.sent.length;
    await h.inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(h.sent, attachMark)).toContainEqual(QUESTION_ASK);
    expect(
      eventsAfter(h.sent, attachMark).some((event) => event.type === 'prompt-response-status'),
    ).toBe(false);
    expect(
      eventsAfter(h.sent, attachMark).some((event) => event.type === 'question-resolved'),
    ).toBe(false);
  });

  it('session-cancels a failed response if the adapter invalidated its ask in flight', async () => {
    const h = harness(new InMemorySessionStore(), () => new InvalidatingRejectingSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]);
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });
    expect(eventsAfter(h.sent, 0)).toContainEqual({
      type: 'question-resolved',
      requestId: 'ask-1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    });

    const mark = h.sent.length;
    await h.inject({ kind: 'session.attach', sessionId });
    expect(eventsAfter(h.sent, mark)).toContainEqual({
      type: 'question-resolved',
      requestId: 'ask-1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    });
  });

  it('keeps the user outcome when a successful response synchronously settles the turn', async () => {
    const h = harness(new InMemorySessionStore(), () => new InvalidatingSuccessfulSendAdapter());
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedId(h.sent, 'r1');
    const adapter = nullthrow(h.adapters[0]);
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_ASK);

    const mark = h.sent.length;
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'r2',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-1', outcome: { outcome: 'cancelled' } },
    });
    const resolutions = eventsAfter(h.sent, mark).filter(
      (event) => event.type === 'question-resolved',
    );
    expect(resolutions).toEqual([
      {
        type: 'question-resolved',
        requestId: 'ask-1',
        outcome: { outcome: 'cancelled' },
        source: 'user',
      },
    ]);
  });

  it('validates complete question answers before dispatching them', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(QUESTION_BATCH);

    const validMultiAnswer = { questionId: 'multi', selectedOptionIds: ['x'] };
    const invalid: Array<{
      outcome: Extract<AgentInput, { type: 'question-response' }>['outcome'];
      error: string;
    }> = [
      {
        outcome: {
          outcome: 'answered',
          answers: [{ questionId: 'single', selectedOptionIds: ['a'] }],
        },
        error: 'must answer every question',
      },
      {
        outcome: {
          outcome: 'answered',
          answers: [
            { questionId: 'single', selectedOptionIds: ['a'] },
            { questionId: 'single', selectedOptionIds: ['b'] },
          ],
        },
        error: 'Duplicate answer for question: single',
      },
      {
        outcome: {
          outcome: 'answered',
          answers: [{ questionId: 'single', selectedOptionIds: ['unknown'] }, validMultiAnswer],
        },
        error: 'Unknown option unknown for question: single',
      },
      {
        outcome: {
          outcome: 'answered',
          answers: [{ questionId: 'single', selectedOptionIds: ['a', 'b'] }, validMultiAnswer],
        },
        error: 'Invalid selection count for question: single',
      },
      {
        outcome: {
          outcome: 'answered',
          answers: [
            { questionId: 'single', selectedOptionIds: ['a'], customText: 'Other' },
            validMultiAnswer,
          ],
        },
        error: 'Custom and structured answers are exclusive: single',
      },
      {
        outcome: {
          outcome: 'answered',
          answers: [
            { questionId: 'single', selectedOptionIds: [], customText: '   ' },
            validMultiAnswer,
          ],
        },
        error: 'Custom answer cannot be blank: single',
      },
      {
        outcome: {
          outcome: 'answered',
          answers: [
            { questionId: 'single', selectedOptionIds: ['a'] },
            { questionId: 'multi', selectedOptionIds: ['x', 'x'] },
          ],
        },
        error: 'Duplicate option in answer: multi',
      },
    ];

    await Promise.all(
      invalid.map((testCase, index) =>
        inject({
          kind: 'agent.input',
          clientReqId: `invalid-${index}`,
          sessionId,
          input: { type: 'question-response', requestId: 'ask-batch', outcome: testCase.outcome },
        }),
      ),
    );
    for (const [index, testCase] of invalid.entries()) {
      const replyTo = `invalid-${index}`;
      const failure = sent.find(
        (payload) => payload.kind === 'request.failed' && payload.replyTo === replyTo,
      );
      expect(failure).toMatchObject({ message: expect.stringContaining(testCase.error) });
    }
    expect(adapter.sentInputs).toEqual([]);

    const outcome = {
      outcome: 'answered' as const,
      answers: [
        { questionId: 'single', selectedOptionIds: [], customText: 'Something else' },
        { questionId: 'multi', selectedOptionIds: ['x', 'y'] },
      ],
    };
    await inject({
      kind: 'agent.input',
      clientReqId: 'valid',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-batch', outcome },
    });
    expect(adapter.sentInputs).toEqual([
      { type: 'question-response', requestId: 'ask-batch', outcome },
    ]);
    expect(eventsAfter(sent, 0)).toContainEqual({
      type: 'question-resolved',
      requestId: 'ask-batch',
      outcome,
      source: 'user',
    });

    // Empty selections with no custom text are explicit skips and dispatch as unanswered.
    adapter.emit({ ...QUESTION_BATCH, requestId: 'ask-batch-2' });
    const skipOutcome = {
      outcome: 'answered' as const,
      answers: [
        { questionId: 'single', selectedOptionIds: [] },
        { questionId: 'multi', selectedOptionIds: [] },
      ],
    };
    await inject({
      kind: 'agent.input',
      clientReqId: 'valid-skip',
      sessionId,
      input: { type: 'question-response', requestId: 'ask-batch-2', outcome: skipOutcome },
    });
    expect(adapter.sentInputs).toContainEqual({
      type: 'question-response',
      requestId: 'ask-batch-2',
      outcome: skipOutcome,
    });
  });

  it('rejects mismatched responses and unadvertised permission options', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);

    await inject({
      kind: 'agent.input',
      clientReqId: 'wrong-kind',
      sessionId,
      input: { type: 'question-response', requestId: 'perm-1', outcome: { outcome: 'cancelled' } },
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'unknown-option',
      sessionId,
      input: {
        type: 'permission-response',
        requestId: 'perm-1',
        outcome: { outcome: 'selected', optionId: 'missing' },
      },
    });
    expect(adapter.sentInputs).toEqual([]);
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'wrong-kind',
      message: 'Error: Request perm-1 does not accept a question response',
    });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'unknown-option',
      message: 'Error: Unknown permission option: missing',
    });

    await inject({
      kind: 'agent.input',
      clientReqId: 'valid',
      sessionId,
      input: {
        type: 'permission-response',
        requestId: 'perm-1',
        outcome: { outcome: 'selected', optionId: 'ok' },
      },
    });
    expect(eventsAfter(sent, 0)).toContainEqual({
      type: 'permission-resolved',
      requestId: 'perm-1',
      outcome: { outcome: 'selected', optionId: 'ok' },
      source: 'user',
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'duplicate',
      sessionId,
      input: {
        type: 'permission-response',
        requestId: 'perm-1',
        outcome: { outcome: 'selected', optionId: 'ok' },
      },
    });
    await inject({
      kind: 'agent.input',
      clientReqId: 'stale',
      sessionId,
      input: {
        type: 'permission-response',
        requestId: 'missing',
        outcome: { outcome: 'cancelled' },
      },
    });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'duplicate',
      message: 'Error: Interactive request already resolved: perm-1',
    });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'stale',
      message: 'Error: Unknown interactive request: missing',
    });
    expect(adapter.sentInputs).toHaveLength(1);
  });

  it('emits and replays a session cancellation when the ask tool settles', async () => {
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
    expect(eventsAfter(sent, mark)).not.toContainEqual(QUESTION_ASK);
    expect(eventsAfter(sent, mark)).toContainEqual({
      type: 'question-resolved',
      requestId: 'ask-1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    });
  });

  it('emits and replays a session cancellation at a turn boundary', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);
    adapter.emit({ type: 'status', status: 'idle' });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const replayed = eventsAfter(sent, mark);
    expect(replayed[0]).toEqual({ type: 'status', status: 'idle' });
    expect(replayed).not.toContainEqual(PERMISSION_ASK);
    expect(replayed).toContainEqual({
      type: 'permission-resolved',
      requestId: 'perm-1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    });
  });

  it('drops resolved ask tombstones when the next turn begins', async () => {
    const { sent, inject, adapter, sessionId } = await startedHarness();
    adapter.emit({ type: 'status', status: 'running' });
    adapter.emit(PERMISSION_ASK);
    adapter.emit({ type: 'status', status: 'idle' });
    adapter.emit({ type: 'status', status: 'running' });

    const mark = sent.length;
    await inject({ kind: 'session.attach', sessionId });
    const replayed = eventsAfter(sent, mark);
    expect(replayed).not.toContainEqual(PERMISSION_ASK);
    expect(replayed.some((event) => event.type === 'permission-resolved')).toBe(false);
  });
});
