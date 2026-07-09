import type { AgentEvent } from '@linkcode/schema';
import type { Event } from '@opencode-ai/sdk/v2';
import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeAdapter } from '../native/opencode';

const sdkMock = vi.hoisted(() => ({
  createOpencode: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencode(opts: unknown) {
    if (!sdkMock.createOpencode) throw new Error('createOpencode mock not installed');
    return sdkMock.createOpencode(opts);
  },
}));

/** Stands in for the SSE `ServerSentEventsResult['stream']` `event.subscribe()` resolves to: an
 * async-iterable queue tests push events into, mirroring the real for-await the adapter drains. */
class FakeEventStream {
  private readonly queued: Array<{ event: unknown } | { done: true } | { failed: unknown }> = [];
  private waiting: (() => void) | null = null;

  push(event: Event): void {
    this.queued.push({ event });
    this.flush();
  }
  /** A raw, possibly malformed payload — bypasses the `Event` shape `push()` requires, standing
   * in for a real SSE frame that doesn't match the SDK's declared types. */
  pushRaw(event: unknown): void {
    this.queued.push({ event });
    this.flush();
  }
  /** The server closing the stream on its own, without the adapter having stopped. */
  end(): void {
    this.queued.push({ done: true });
    this.flush();
  }
  /** The iterator itself failing (e.g. a dropped connection). */
  fail(err: unknown): void {
    this.queued.push({ failed: err });
    this.flush();
  }

  private flush(): void {
    const wake = this.waiting;
    this.waiting = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Event> {
    while (true) {
      if (this.queued.length === 0) {
        // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-event signal
        await new Promise<void>((resolve) => {
          this.waiting = resolve;
        });
        continue;
      }
      const item = this.queued.shift()!;
      if ('done' in item) return;
      if ('failed' in item) throw item.failed;
      yield item.event as Event;
    }
  }
}

class FakeClient {
  readonly stream = new FakeEventStream();
  subscribeError: Error | null = null;
  readonly session = {
    create: vi.fn(() => ({ data: { id: 'sess-1' } })),
    promptAsync: vi.fn(() => ({ data: null })),
    abort: vi.fn(() => ({ data: true })),
  };
  readonly permission = {
    reply: vi.fn(() => ({ data: true })),
  };
  readonly question = {
    reply: vi.fn(() => ({ data: true })),
    reject: vi.fn(() => ({ data: true })),
  };
  readonly event = {
    subscribe: vi.fn(() => {
      if (this.subscribeError) throw this.subscribeError;
      return { stream: this.stream };
    }),
  };
}

const closeServer = vi.fn();
let client: FakeClient;

sdkMock.createOpencode = () => {
  client = new FakeClient();
  return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
};

afterEach(() => {
  closeServer.mockClear();
});

async function makeAdapter(): Promise<{ adapter: OpenCodeAdapter; events: AgentEvent[] }> {
  const adapter = new OpenCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'opencode', cwd: '/tmp/repo' });
  return { adapter, events };
}

function errors(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'error' }>> {
  return events.filter((e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error');
}

function permissionAsks(
  events: AgentEvent[],
): Array<Extract<AgentEvent, { type: 'permission-request' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'permission-request' }> =>
      e.type === 'permission-request',
  );
}

function questionAsks(
  events: AgentEvent[],
): Array<Extract<AgentEvent, { type: 'question-request' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'question-request' }> => e.type === 'question-request',
  );
}

function stops(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'stop' }>> {
  return events.filter((e): e is Extract<AgentEvent, { type: 'stop' }> => e.type === 'stop');
}

function pushPermissionAsked(withTool: boolean): void {
  client.stream.push({
    id: 'e-perm',
    type: 'permission.asked',
    properties: {
      id: 'per-1',
      sessionID: 'sess-1',
      permission: 'bash',
      patterns: ['echo hi'],
      metadata: { command: 'echo hi' },
      always: ['echo *'],
      ...(withTool && { tool: { messageID: 'msg-1', callID: 'call-1' } }),
    },
  });
}

function pushIdle(): void {
  client.stream.push({
    id: 'e-idle',
    type: 'session.idle',
    properties: { sessionID: 'sess-1' },
  });
}

describe('OpenCodeAdapter.consumeEvents', () => {
  it('reports a malformed event via emitError instead of throwing, and keeps consuming', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { events } = await makeAdapter();

      // `part` missing on a message.part.updated event — an unexpected shape handlePart cannot
      // handle; must not escape as an unhandled rejection or kill the stream.
      client.stream.pushRaw({
        id: 'e1',
        type: 'message.part.updated',
        properties: { sessionID: 'sess-1', time: 0 },
      });
      await vi.waitFor(() => {
        expect(errors(events)).toHaveLength(1);
      });

      // The stream keeps running afterwards: a well-formed event right after still gets through.
      client.stream.push({
        id: 'e2',
        type: 'message.part.updated',
        properties: {
          sessionID: 'sess-1',
          time: 0,
          part: { id: 'p1', sessionID: 'sess-1', messageID: 'msg-1', type: 'text', text: 'hi' },
        },
      });
      await vi.waitFor(() => {
        expect(events.some((e) => e.type === 'agent-message-chunk')).toBe(true);
      });

      await vi.waitFor(() => {
        expect(unhandled).not.toHaveBeenCalled();
      });
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('treats the stream ending after the turn already went idle as expected, not an error', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    client.stream.push({
      id: 'e-idle',
      type: 'session.idle',
      properties: { sessionID: 'sess-1' },
    });
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    events.length = 0;

    // opencode closing the SSE stream right after the turn ended is the normal fallout of a
    // completed round-trip, not a failure — there's nothing left to interrupt.
    client.stream.end();

    await vi.waitFor(() => {
      // Give the loop a chance to run; nothing should ever land.
      expect(events).toHaveLength(0);
    });
  });

  it('treats the stream closing while a turn is still active as a fatal error and stops the session', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    // The stream closes mid-turn — before `session.idle` — so the in-flight round-trip can no
    // longer receive completion signals.
    client.stream.end();

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].recoverable).toBe(false);
    // `stopped`, not `idle` — the shell only disables the composer on `stopped`, and a session that
    // can no longer receive events must not look usable.
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(false);
  });

  it('treats a cancel-triggered stream close as the expected fallout of the abort, not an error', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    await adapter.send({ type: 'cancel' });
    expect(client.session.abort).toHaveBeenCalledWith({
      sessionID: 'sess-1',
      directory: '/tmp/repo',
    });

    // Cancel aborts the turn without a matching `session.idle`; opencode then closes the stream —
    // that's the abort's own fallout, not an unexpected disconnect.
    client.stream.end();

    await vi.waitFor(() => {
      // Give the loop a chance to run; nothing should ever land.
      expect(events).toHaveLength(0);
    });
  });

  it('does not latch the cancel suppression when abort() itself rejects, so a later stream failure still surfaces', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    // The abort request fails: the turn was never actually cancelled, so no cancel-induced close
    // is coming. `send('cancel')` rejects — the caller sees the failure directly.
    client.session.abort.mockRejectedValueOnce(new Error('abort failed'));
    await expect(adapter.send({ type: 'cancel' })).rejects.toThrow('abort failed');

    // A genuine disconnect afterwards must NOT be swallowed as an expected cancel close.
    client.stream.fail(new Error('connection dropped'));

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].recoverable).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
  });

  it('reports a subscribe() rejection without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const adapter = new OpenCodeAdapter();
      const events: AgentEvent[] = [];
      adapter.onEvent((e) => events.push(e));

      sdkMock.createOpencode = () => {
        client = new FakeClient();
        client.subscribeError = new Error('beforeRequest hook rejected');
        return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
      };
      await adapter.start({ kind: 'opencode', cwd: '/tmp/repo' });

      await vi.waitFor(() => {
        expect(errors(events)).toHaveLength(1);
      });
      expect(errors(events)[0].message).toContain('beforeRequest hook rejected');
      expect(errors(events)[0].recoverable).toBe(false);
      expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);

      await vi.waitFor(() => {
        expect(unhandled).not.toHaveBeenCalled();
      });
    } finally {
      process.off('unhandledRejection', unhandled);
      sdkMock.createOpencode = () => {
        client = new FakeClient();
        return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
      };
    }
  });

  it('on stop(): the stream ending afterwards is the expected shutdown, not an error', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.stop();
    events.length = 0;

    // stop() already closed the server; the stream ending is the normal fallout, not a failure.
    client.stream.end();
    await vi.waitFor(() => {
      // Give the loop a chance to run; nothing should ever land.
      expect(events).toHaveLength(0);
    });
  });
});

describe('OpenCodeAdapter prompt dispatch', () => {
  it('subscribes the event stream scoped to the session directory', async () => {
    await makeAdapter();
    // Session events ride the per-directory instance bus; a bare subscribe() silently misses them
    // whenever the daemon cwd differs from the session cwd.
    expect(client.event.subscribe).toHaveBeenCalledWith({ directory: '/tmp/repo' });
  });

  it('dispatches prompts via promptAsync so send() is not held open for the whole turn', async () => {
    const adapter = new OpenCodeAdapter();
    adapter.onEvent(noop);
    await adapter.start({ kind: 'opencode', cwd: '/tmp/repo', model: 'openai/gpt-5.5' });

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });

    expect(client.session.promptAsync).toHaveBeenCalledWith({
      sessionID: 'sess-1',
      directory: '/tmp/repo',
      model: { providerID: 'openai', modelID: 'gpt-5.5' },
      parts: [{ type: 'text', text: 'hi' }],
    });
  });
});

describe('OpenCodeAdapter permission round-trip', () => {
  it('surfaces permission.asked joined to the announced tool part and replies per the picked option', async () => {
    const { adapter, events } = await makeAdapter();

    // The gated tool part is announced first (observed live: pending → running → permission.asked);
    // the ask cites it by callID and must land on the same card id.
    client.stream.push({
      id: 'e-tool',
      type: 'message.part.updated',
      properties: {
        sessionID: 'sess-1',
        time: 0,
        part: {
          id: 'prt-1',
          sessionID: 'sess-1',
          messageID: 'msg-1',
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: { status: 'running', input: { command: 'echo hi' }, time: { start: 0 } },
        },
      },
    });
    pushPermissionAsked(true);

    await vi.waitFor(() => {
      expect(permissionAsks(events)).toHaveLength(1);
    });
    const ask = permissionAsks(events)[0];
    expect(ask.toolCall.toolCallId).toBe('prt-1');
    expect(ask.options.map((o) => o.optionId)).toEqual(['allow', 'allow_always', 'reject']);

    await adapter.send({
      type: 'permission-response',
      requestId: ask.requestId,
      outcome: { outcome: 'selected', optionId: 'allow' },
    });
    await vi.waitFor(() => {
      expect(client.permission.reply).toHaveBeenCalledWith({
        requestID: 'per-1',
        directory: '/tmp/repo',
        reply: 'once',
      });
    });
  });

  it.each([
    ['allow_always', 'always'],
    ['reject', 'reject'],
  ] as const)('maps the %s option onto the %s reply', async (optionId, reply) => {
    const { adapter, events } = await makeAdapter();
    pushPermissionAsked(false);
    await vi.waitFor(() => {
      expect(permissionAsks(events)).toHaveLength(1);
    });

    await adapter.send({
      type: 'permission-response',
      requestId: permissionAsks(events)[0].requestId,
      outcome: { outcome: 'selected', optionId },
    });
    await vi.waitFor(() => {
      expect(client.permission.reply).toHaveBeenCalledWith({
        requestID: 'per-1',
        directory: '/tmp/repo',
        reply,
      });
    });
  });

  it('replies reject when a cancel tears down the pending ask, so the server-side gate never dangles', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    pushPermissionAsked(false);
    await vi.waitFor(() => {
      expect(permissionAsks(events)).toHaveLength(1);
    });

    await adapter.send({ type: 'cancel' });

    await vi.waitFor(() => {
      expect(client.permission.reply).toHaveBeenCalledWith({
        requestID: 'per-1',
        directory: '/tmp/repo',
        reply: 'reject',
      });
    });
  });

  it('swallows a reply failure for a teardown-cancelled ask (the abort already discarded it)', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    client.permission.reply.mockRejectedValueOnce(new Error('ask already settled'));
    pushPermissionAsked(false);
    await vi.waitFor(() => {
      expect(permissionAsks(events)).toHaveLength(1);
    });
    events.length = 0;

    await adapter.send({ type: 'cancel' });

    await vi.waitFor(() => {
      expect(client.permission.reply).toHaveBeenCalled();
    });
    expect(errors(events)).toHaveLength(0);
  });
});

describe('OpenCodeAdapter question round-trip', () => {
  function pushQuestionAsked(): void {
    client.stream.push({
      id: 'e-question',
      type: 'question.asked',
      properties: {
        id: 'que-1',
        sessionID: 'sess-1',
        questions: [
          {
            question: 'Proceed?',
            header: 'Proceed',
            options: [
              { label: 'Yes', description: 'Go ahead.' },
              { label: 'No', description: 'Stop here.' },
            ],
            multiple: false,
          },
        ],
        tool: { messageID: 'msg-1', callID: 'call-1' },
      },
    });
  }

  it('surfaces question.asked as a question-request and replies with the selected labels', async () => {
    const { adapter, events } = await makeAdapter();
    pushQuestionAsked();
    await vi.waitFor(() => {
      expect(questionAsks(events)).toHaveLength(1);
    });
    const ask = questionAsks(events)[0];
    expect(ask.questions[0].prompt).toBe('Proceed?');
    expect(ask.questions[0].options.map((o) => o.label)).toEqual(['Yes', 'No']);

    await adapter.send({
      type: 'question-response',
      requestId: ask.requestId,
      outcome: { outcome: 'answered', answers: [{ questionId: 'q0', selectedOptionIds: ['o0'] }] },
    });
    await vi.waitFor(() => {
      // One label array per question, in order — question.replied echoes exactly this shape.
      expect(client.question.reply).toHaveBeenCalledWith({
        requestID: 'que-1',
        directory: '/tmp/repo',
        answers: [['Yes']],
      });
    });
  });

  it('rejects the ask when the user declines', async () => {
    const { adapter, events } = await makeAdapter();
    pushQuestionAsked();
    await vi.waitFor(() => {
      expect(questionAsks(events)).toHaveLength(1);
    });

    await adapter.send({
      type: 'question-response',
      requestId: questionAsks(events)[0].requestId,
      outcome: { outcome: 'cancelled' },
    });
    await vi.waitFor(() => {
      expect(client.question.reject).toHaveBeenCalledWith({
        requestID: 'que-1',
        directory: '/tmp/repo',
      });
    });
  });
});

describe('OpenCodeAdapter session.error and turn settle', () => {
  it('maps ProviderAuthError to a non-recoverable authentication_failed error, and the idle settle skips end_turn', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    client.stream.push({
      id: 'e-err',
      type: 'session.error',
      properties: {
        sessionID: 'sess-1',
        error: { name: 'ProviderAuthError', data: { providerID: 'openai', message: '401' } },
      },
    });
    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].code).toBe('authentication_failed');
    expect(errors(events)[0].recoverable).toBe(false);

    pushIdle();
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    // The error already told the story; an end_turn stop would make the turn look clean.
    expect(stops(events)).toHaveLength(0);
  });

  it('ignores a duplicate session.error after the turn settled (observed live: re-emitted with a stack)', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });

    const push = () => {
      client.stream.push({
        id: 'e-err',
        type: 'session.error',
        properties: {
          sessionID: 'sess-1',
          error: { name: 'UnknownError', data: { message: 'model not found' } },
        },
      });
    };
    push();
    pushIdle();
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    events.length = 0;

    push();
    await vi.waitFor(() => {
      expect(events).toHaveLength(0);
    });
  });

  it('treats MessageAbortedError as cancel fallout: no error, and the idle settle reports cancelled', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    // An abort not initiated through this adapter (e.g. another client) — same settle path.
    client.stream.push({
      id: 'e-err',
      type: 'session.error',
      properties: {
        sessionID: 'sess-1',
        error: { name: 'MessageAbortedError', data: { message: 'Aborted' } },
      },
    });
    pushIdle();

    await vi.waitFor(() => {
      expect(stops(events)).toHaveLength(1);
    });
    expect(stops(events)[0].stopReason).toBe('cancelled');
    expect(errors(events)).toHaveLength(0);
  });

  it('settles a cancelled turn with a cancelled stop, and a duplicate idle emits nothing more', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    await adapter.send({ type: 'cancel' });
    events.length = 0;

    // Observed live on an abort: session.idle arrives, sometimes twice.
    pushIdle();
    await vi.waitFor(() => {
      expect(stops(events)).toHaveLength(1);
    });
    expect(stops(events)[0].stopReason).toBe('cancelled');
    events.length = 0;

    pushIdle();
    await vi.waitFor(() => {
      expect(events).toHaveLength(0);
    });
  });

  it('proceeds with the local cancel when session.abort exceeds the wait cap', async () => {
    const { adapter } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });

    vi.useFakeTimers();
    try {
      // The abort RPC hangs (opencode has blocked it until the running tool exits).
      client.session.abort.mockImplementationOnce(() => new Promise(noop) as never);
      const cancel = adapter.send({ type: 'cancel' });
      await vi.advanceTimersByTimeAsync(2000);
      await cancel;
    } finally {
      vi.useRealTimers();
    }
  });
});
