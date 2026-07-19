import type { AgentEvent, AgentInput, WirePayload } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { InMemorySessionStore } from '../session/session-store';
import {
  FakeAdapter,
  createSessionHarness as harness,
  startedSessionId as startedId,
  settleEngineTasks as tick,
} from './fixtures/session-harness';

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

describe('engine interactive requests', () => {
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
