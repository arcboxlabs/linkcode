import type { AgentEvent } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
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

import { FakeEventStream } from './fake-event-stream';

class FakeClient {
  readonly stream = new FakeEventStream();
  subscribeError: Error | null = null;
  readonly session = {
    create: vi.fn(() => ({ data: { id: 'sess-1' } })),
    promptAsync: vi.fn(() => ({ data: null })),
    abort: vi.fn(() => ({ data: true })),
    command: vi.fn(() => Promise.resolve({ data: { info: {}, parts: [] } })),
    shell: vi.fn(() => Promise.resolve({ data: { info: {}, parts: [] } })),
  };
  readonly permission = {
    reply: vi.fn(() => ({ data: true })),
  };
  readonly question = {
    reply: vi.fn(() => ({ data: true })),
    reject: vi.fn(() => ({ data: true })),
  };
  readonly command = {
    list: vi.fn(() => ({ data: [] as unknown[] })),
  };
  readonly app = {
    agents: vi.fn(() => ({ data: [] as unknown[] })),
  };
  readonly provider = {
    list: vi.fn(() => ({
      data: { all: [] as unknown[], default: {}, connected: [] as string[] },
    })),
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

/** Flush the fake stream before an ABSENCE assertion: pushed events drain on microtasks, so one
 * macrotask turn guarantees they were processed — `vi.waitFor` alone passes an emptiness check on
 * its first tick, before the event ever reached `handleEvent`. */
function drained(): Promise<void> {
  return wait(0);
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

/** The server's on-stream acknowledgement that the active turn is running — always precedes the
 * turn's own error/idle on the real stream (verified live on 1.17.11). */
function pushBusy(): void {
  client.stream.push({
    id: 'e-busy',
    type: 'session.status',
    properties: { sessionID: 'sess-1', status: { type: 'busy' } },
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

  it('skips parts of a user message, so the prompt text is not replayed as agent output', async () => {
    const { events } = await makeAdapter();

    // opencode streams message.part.updated for the user's own prompt too; the role arrives first
    // on message.updated (observed live on 1.17.11).
    client.stream.push({
      id: 'e-user-msg',
      type: 'message.updated',
      properties: {
        sessionID: 'sess-1',
        info: {
          id: 'msg-user',
          sessionID: 'sess-1',
          role: 'user',
          time: { created: 0 },
          agent: 'build',
          model: { providerID: 'openai', modelID: 'gpt-5.5' },
        },
      },
    });
    client.stream.push({
      id: 'e-user-part',
      type: 'message.part.updated',
      properties: {
        sessionID: 'sess-1',
        time: 0,
        part: {
          id: 'p-user',
          sessionID: 'sess-1',
          messageID: 'msg-user',
          type: 'text',
          text: 'my prompt',
        },
      },
    });
    client.stream.push({
      id: 'e-assistant-part',
      type: 'message.part.updated',
      properties: {
        sessionID: 'sess-1',
        time: 0,
        part: {
          id: 'p-assist',
          sessionID: 'sess-1',
          messageID: 'msg-assist',
          type: 'text',
          text: 'reply',
        },
      },
    });

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'agent-message-chunk')).toBe(true);
    });
    const chunks = events.filter(
      (e): e is Extract<AgentEvent, { type: 'agent-message-chunk' }> =>
        e.type === 'agent-message-chunk',
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toEqual({ type: 'text', text: 'reply' });
  });

  it('treats the stream ending after the turn already went idle as expected, not an error', async () => {
    const { adapter, events } = await makeAdapter();

    await adapter.send({ type: 'prompt', content: [] });
    // Drop the startup statuses: the idle awaited below must be the SETTLE's, not start()'s.
    events.length = 0;
    pushBusy();
    pushIdle();
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    events.length = 0;

    // opencode closing the SSE stream right after the turn ended is the normal fallout of a
    // completed round-trip, not a failure — there's nothing left to interrupt.
    client.stream.end();

    await drained();
    expect(events).toHaveLength(0);
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

    await drained();
    expect(events).toHaveLength(0);
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
    await drained();
    expect(events).toHaveLength(0);
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
    pushBusy();
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
    // Drop the startup statuses: the idle awaited below must be the SETTLE's, not start()'s.
    events.length = 0;
    pushBusy();

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
    await drained();
    expect(events).toHaveLength(0);
  });

  it('treats MessageAbortedError as cancel fallout: no error, and the idle settle reports cancelled', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    pushBusy();
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
    await drained();
    expect(events).toHaveLength(0);
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

  it("absorbs the previous turn's straggling duplicate idle instead of settling the next un-started turn", async () => {
    const { adapter, events } = await makeAdapter();

    // Turn 1: started, cancelled, settled (opencode emits a duplicate idle after an abort — the
    // straggler can arrive after the next prompt is already dispatched).
    await adapter.send({ type: 'prompt', content: [] });
    pushBusy();
    await adapter.send({ type: 'cancel' });
    pushIdle();
    await vi.waitFor(() => {
      expect(stops(events).map((s) => s.stopReason)).toEqual(['cancelled']);
    });

    // Turn 2 dispatched; turn 1's duplicate idle lands before turn 2's busy acknowledgement.
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    try {
      pushIdle();
      await drained();
      expect(events).toHaveLength(0);
      // The absorb leaves a trace — the one diagnostic if a server never emits session.status
      // (the turn would then hang at `running` with no error).
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }

    // Turn 2's real lifecycle still settles normally.
    pushBusy();
    pushIdle();
    await vi.waitFor(() => {
      expect(stops(events).map((s) => s.stopReason)).toEqual(['end_turn']);
    });
  });

  it("drops the previous turn's re-fired session.error instead of failing the next un-started turn", async () => {
    const { adapter, events } = await makeAdapter();

    const pushError = () => {
      client.stream.push({
        id: 'e-err',
        type: 'session.error',
        properties: {
          sessionID: 'sess-1',
          error: { name: 'UnknownError', data: { message: 'model not found' } },
        },
      });
    };

    // Turn 1 fails and settles.
    await adapter.send({ type: 'prompt', content: [] });
    pushBusy();
    pushError();
    pushIdle();
    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });

    // Turn 2 dispatched; turn 1's stale re-fire lands before turn 2's busy acknowledgement.
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;
    pushError();
    pushBusy();
    pushIdle();
    await vi.waitFor(() => {
      expect(stops(events).map((s) => s.stopReason)).toEqual(['end_turn']);
    });
    // No error was attributed to turn 2, and its clean settle wasn't suppressed by a stale
    // turnFailed.
    expect(errors(events)).toHaveLength(0);
  });

  it('handles a session.error that carries no sessionID (the SDK declares it optional)', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    pushBusy();
    events.length = 0;

    client.stream.push({
      id: 'e-err',
      type: 'session.error',
      properties: {
        error: { name: 'ProviderAuthError', data: { providerID: 'openai', message: '401' } },
      },
    });
    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].code).toBe('authentication_failed');
  });
});

describe('OpenCodeAdapter RPC results (the SDK resolves with {error} instead of rejecting)', () => {
  it('rejects send() and returns the session to idle when promptAsync resolves with an error', async () => {
    const { adapter, events } = await makeAdapter();
    client.session.promptAsync.mockResolvedValueOnce({ error: { message: 'boom' } } as never);

    await expect(adapter.send({ type: 'prompt', content: [] })).rejects.toThrow(
      'session.promptAsync failed',
    );
    const statuses = events.filter(
      (e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status',
    );
    expect(statuses.at(-1)?.status).toBe('idle');
  });

  it('surfaces a permission.reply that resolves with an error for a user-answered ask', async () => {
    const { adapter, events } = await makeAdapter();
    client.permission.reply.mockResolvedValueOnce({ error: { message: 'gone' } } as never);
    pushPermissionAsked(false);
    await vi.waitFor(() => {
      expect(permissionAsks(events)).toHaveLength(1);
    });

    await adapter.send({
      type: 'permission-response',
      requestId: permissionAsks(events)[0].requestId,
      outcome: { outcome: 'selected', optionId: 'allow' },
    });
    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].message).toContain('permission.reply failed');
  });

  it('rejects send(cancel) and clears the cancel latch when session.abort resolves with an error', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    client.session.abort.mockResolvedValueOnce({ error: { message: 'gone' } } as never);
    await expect(adapter.send({ type: 'cancel' })).rejects.toThrow('session.abort failed');

    // The latch was cleared, so a genuine stream failure afterwards still surfaces.
    client.stream.fail(new Error('connection dropped'));
    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
  });

  it('clears the cancel latch when the straggling abort fails after the wait cap', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    let rejectAbort: ((err: Error) => void) | undefined;
    vi.useFakeTimers();
    try {
      client.session.abort.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectAbort = reject;
          }) as never,
      );
      const cancel = adapter.send({ type: 'cancel' });
      await vi.advanceTimersByTimeAsync(2000);
      await cancel;
      // The straggling abort ultimately fails: no cancel fallout is coming.
      rejectAbort?.(new Error('abort finally failed'));
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }

    // A genuine stream failure afterwards must surface, not be swallowed as cancel fallout.
    client.stream.fail(new Error('connection dropped'));
    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
  });

  it("keeps the latch owned by a repeat cancel when the first cancel's straggling abort later fails", async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'prompt', content: [] });
    events.length = 0;

    let rejectAbort: ((err: Error) => void) | undefined;
    vi.useFakeTimers();
    try {
      client.session.abort.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectAbort = reject;
          }) as never,
      );
      const cancel = adapter.send({ type: 'cancel' });
      await vi.advanceTimersByTimeAsync(2000);
      await cancel;

      // A repeat cancel — its abort succeeds (default mock) — takes over the latch.
      await adapter.send({ type: 'cancel' });

      // The FIRST cancel's straggling abort finally fails; the flags belong to the repeat cancel
      // now, so the late-failure watcher must not clear the latch.
      rejectAbort?.(new Error('first abort finally failed'));
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }

    // The stream fallout of the repeat cancel's clean abort is still expected — not an error.
    client.stream.fail(new Error('cancel-induced close'));
    await drained();
    expect(errors(events)).toHaveLength(0);
    expect(events.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(false);
  });
});

describe('OpenCodeAdapter command catalog', () => {
  afterEach(() => {
    // Restore the default fresh-client factory the rest of the file (and other describe blocks)
    // relies on — the tests below swap it out to seed a customized `command.list` return value.
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
  });

  it('emits the catalog mapped from command.list at start', async () => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      client.command.list.mockReturnValueOnce({
        data: [
          { name: 'review', description: 'Review code', template: 't', hints: ['<file>'] },
          { name: 'noop', template: 't', hints: [] },
        ],
      });
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    const { events } = await makeAdapter();

    const catalog = events.filter(
      (e): e is Extract<AgentEvent, { type: 'available-commands-update' }> =>
        e.type === 'available-commands-update',
    );
    expect(catalog).toHaveLength(1);
    expect(catalog[0].commands).toEqual([
      { name: 'review', description: 'Review code', argumentHint: '<file>' },
      { name: 'noop', description: undefined, argumentHint: undefined },
    ]);
  });

  it('still starts successfully when command.list resolves with an error envelope', async () => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      client.command.list.mockReturnValueOnce({ error: { message: 'boom' } } as never);
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    const { events } = await makeAdapter();

    expect(events.some((e) => e.type === 'available-commands-update')).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });
});

describe('OpenCodeAdapter command dispatch', () => {
  it('calls session.command with the given arguments, emits running, and settles on session.idle', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await adapter.send({ type: 'command', name: 'review', arguments: 'src' });

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: 'sess-1',
      directory: '/tmp/repo',
      command: 'review',
      arguments: 'src',
      model: undefined,
    });
    expect(events.some((e) => e.type === 'status' && e.status === 'running')).toBe(true);

    pushBusy();
    pushIdle();
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    expect(stops(events)).toHaveLength(1);
    expect(stops(events)[0].stopReason).toBe('end_turn');
  });

  it('defaults arguments to an empty string when none are given', async () => {
    const { adapter } = await makeAdapter();

    await adapter.send({ type: 'command', name: 'review' });

    expect(client.session.command).toHaveBeenCalledWith({
      sessionID: 'sess-1',
      directory: '/tmp/repo',
      command: 'review',
      arguments: '',
      model: undefined,
    });
  });

  it('fails the turn when session.command resolves with an error envelope', async () => {
    const { adapter, events } = await makeAdapter();
    client.session.command.mockResolvedValueOnce({ error: { message: 'bad command' } } as never);
    events.length = 0;

    await adapter.send({ type: 'command', name: 'review', arguments: 'x' });

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].message).toContain('session.command failed');
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });

  it('rejects a concurrent command without replacing the active turn state', async () => {
    const { adapter, events } = await makeAdapter();
    let resolveFirst: ((value: unknown) => void) | undefined;
    client.session.command.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }) as never,
    );

    void adapter.send({ type: 'command', name: 'first' });
    await expect(adapter.send({ type: 'command', name: 'second' })).rejects.toThrow(
      'opencode: session is busy',
    );
    expect(client.session.command).toHaveBeenCalledTimes(1);
    events.length = 0;

    resolveFirst?.({ error: { message: 'first failure' } });
    await vi.waitFor(() => expect(errors(events)).toHaveLength(1));
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });
});

describe('OpenCodeAdapter shell-command dispatch', () => {
  it('resolves the primary agent from app.agents and calls session.shell with it', async () => {
    const { adapter, events } = await makeAdapter();
    client.app.agents.mockReturnValueOnce({
      data: [
        { name: 'sub', mode: 'subagent' },
        { name: 'build', mode: 'primary' },
      ],
    });
    events.length = 0;

    await adapter.send({ type: 'shell-command', command: 'ls' });

    expect(client.app.agents).toHaveBeenCalledWith({ directory: '/tmp/repo' });
    expect(client.session.shell).toHaveBeenCalledWith({
      sessionID: 'sess-1',
      directory: '/tmp/repo',
      agent: 'build',
      command: 'ls',
    });
    expect(events.some((e) => e.type === 'status' && e.status === 'running')).toBe(true);
    // The late catalog success also re-arms the approval-policy axis missed at start.
    expect(
      events.some(
        (e) => e.type === 'approval-policy-update' && e.state.currentPolicyId === 'build',
      ),
    ).toBe(true);
  });

  it('settles the turn via the HTTP-resolve backstop when no session.idle ever arrives', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await adapter.send({ type: 'shell-command', command: 'ls' });

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });
    expect(stops(events)).toHaveLength(1);
    expect(stops(events)[0].stopReason).toBe('end_turn');
  });

  it('does not double-settle when session.idle arrives before the HTTP-resolve backstop', async () => {
    const { adapter, events } = await makeAdapter();
    let resolveShell: ((value: unknown) => void) | undefined;
    client.session.shell.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveShell = resolve;
        }) as never,
    );
    events.length = 0;

    await adapter.send({ type: 'shell-command', command: 'ls' });
    pushBusy();
    pushIdle();
    await vi.waitFor(() => {
      expect(stops(events)).toHaveLength(1);
    });

    // The subprocess-bound response finally comes back after the stream already settled the turn.
    resolveShell?.({ data: { info: {}, parts: [] } });
    await drained();
    expect(stops(events)).toHaveLength(1);
  });

  it('surfaces a SessionBusyError envelope as a turn failure', async () => {
    const { adapter, events } = await makeAdapter();
    client.session.shell.mockResolvedValueOnce({
      error: { _tag: 'SessionBusyError', sessionID: 'sess-1', message: 'busy' },
    } as never);
    events.length = 0;

    await adapter.send({ type: 'shell-command', command: 'ls' });

    await vi.waitFor(() => {
      expect(errors(events)).toHaveLength(1);
    });
    expect(errors(events)[0].message).toContain('session.shell failed');
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });
});

describe('OpenCodeAdapter server spawn (CODE-242)', () => {
  afterEach(() => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
  });

  it('passes a dedicated allocated port so concurrent sessions never collide on 4096', async () => {
    const seen: unknown[] = [];
    sdkMock.createOpencode = (opts: unknown) => {
      seen.push(opts);
      client = new FakeClient();
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    await makeAdapter();

    expect(seen).toHaveLength(1);
    const opts = seen[0] as { port?: unknown };
    expect(typeof opts.port).toBe('number');
    expect(opts.port).not.toBe(4096);
  });
});

describe('OpenCodeAdapter server spawn retry', () => {
  afterEach(() => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
  });

  it('retries once with a fresh port when the first spawn fails (stolen-port race)', async () => {
    const ports: unknown[] = [];
    let attempts = 0;
    sdkMock.createOpencode = (opts: unknown) => {
      ports.push((opts as { port?: unknown }).port);
      attempts += 1;
      if (attempts === 1) throw new Error('Server exited with code 1');
      client = new FakeClient();
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    const adapter = new OpenCodeAdapter();
    adapter.onEvent(noop);

    await adapter.start({ kind: 'opencode', cwd: '/tmp/repo' });

    expect(attempts).toBe(2);
    // Both attempts carry a real allocated port. (The OS may legitimately hand the retry the
    // same now-free port, so inequality is deliberately not asserted.)
    expect(typeof ports[0]).toBe('number');
    expect(typeof ports[1]).toBe('number');
  });
});

describe('OpenCodeAdapter control plane (CODE-224)', () => {
  afterEach(() => {
    // Restore the default fresh-client factory (same discipline as the command-catalog block).
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
  });

  /** Seed the agent catalog the way a real `app.agents` responds: primaries, an `all`-mode
   * agent, plus the two kinds that must be filtered out (hidden, subagent). */
  function seedAgents(): void {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      client.app.agents.mockReturnValue({
        data: [
          { name: 'build', mode: 'primary', description: 'Default implementation agent' },
          { name: 'plan', mode: 'primary' },
          { name: 'helper', mode: 'all' },
          { name: 'stealth', mode: 'primary', hidden: true },
          { name: 'reviewer', mode: 'subagent' },
        ],
      });
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
  }

  function policyUpdates(
    events: AgentEvent[],
  ): Array<Extract<AgentEvent, { type: 'approval-policy-update' }>> {
    return events.filter(
      (e): e is Extract<AgentEvent, { type: 'approval-policy-update' }> =>
        e.type === 'approval-policy-update',
    );
  }

  it('advertises selectable agents as the approval-policy axis at start', async () => {
    seedAgents();
    const { adapter, events } = await makeAdapter();

    const updates = policyUpdates(events);
    expect(updates).toHaveLength(1);
    expect(updates[0].state).toEqual({
      availablePolicies: [
        { policyId: 'build', name: 'Build', description: 'Default implementation agent' },
        { policyId: 'plan', name: 'Plan' },
        { policyId: 'helper', name: 'Helper' },
      ],
      currentPolicyId: 'build',
    });

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'build' }),
    );
  });

  it('keeps the axis hidden when discovery returns nothing selectable', async () => {
    const { adapter, events } = await makeAdapter();

    expect(policyUpdates(events)).toHaveLength(0);
    await expect(adapter.send({ type: 'set-approval-policy', policyId: 'plan' })).rejects.toThrow(
      "opencode: unknown approval policy 'plan'",
    );
  });

  it('set-approval-policy switches the agent riding subsequent prompts and commands', async () => {
    seedAgents();
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await adapter.send({ type: 'set-approval-policy', policyId: 'plan' });

    const updates = policyUpdates(events);
    expect(updates).toHaveLength(1);
    expect(updates[0].state.currentPolicyId).toBe('plan');

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'plan' }),
    );
    pushBusy();
    pushIdle();
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
    });

    await adapter.send({ type: 'command', name: 'review' });
    expect(client.session.command).toHaveBeenCalledWith(expect.objectContaining({ agent: 'plan' }));
  });

  it('rejects an unknown approval policy id without touching the current pick', async () => {
    seedAgents();
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await expect(
      adapter.send({ type: 'set-approval-policy', policyId: 'bypassPermissions' }),
    ).rejects.toThrow("opencode: unknown approval policy 'bypassPermissions'");
    expect(policyUpdates(events)).toHaveLength(0);

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'build' }),
    );
  });

  it('shell passthrough runs under the selected agent without a lazy re-fetch', async () => {
    seedAgents();
    const { adapter } = await makeAdapter();
    await adapter.send({ type: 'set-approval-policy', policyId: 'helper' });
    client.app.agents.mockClear();

    await adapter.send({ type: 'shell-command', command: 'ls' });

    expect(client.session.shell).toHaveBeenCalledWith(expect.objectContaining({ agent: 'helper' }));
    expect(client.app.agents).not.toHaveBeenCalled();
  });

  it('set-model reflects immediately and rides the next prompt', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await adapter.send({ type: 'set-model', model: 'openai/gpt-5-nano' });

    expect(events).toEqual([{ type: 'model-update', model: 'openai/gpt-5-nano' }]);

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ model: { providerID: 'openai', modelID: 'gpt-5-nano' } }),
    );
  });

  it('rejects a set-model ref that is not providerID/modelID', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;

    await expect(adapter.send({ type: 'set-model', model: 'gpt-5-nano' })).rejects.toThrow(
      "opencode: model must be 'providerID/modelID'",
    );
    expect(events.some((e) => e.type === 'model-update')).toBe(false);

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    expect(client.session.promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({ model: undefined }),
    );
  });

  it('rejects a cross-provider switch when a per-account credential was injected at spawn', async () => {
    const adapter = new OpenCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({
      kind: 'opencode',
      cwd: '/tmp/repo',
      model: 'openai/gpt-5.5',
      config: { apiKey: 'sk-test' },
    });

    await expect(
      adapter.send({ type: 'set-model', model: 'anthropic/claude-opus-4' }),
    ).rejects.toThrow("holds credentials for 'openai' only");

    // Same-provider switches stay allowed.
    await adapter.send({ type: 'set-model', model: 'openai/gpt-5-nano' });
    expect(events.some((e) => e.type === 'model-update' && e.model === 'openai/gpt-5-nano')).toBe(
      true,
    );
  });

  it('advertises connected provider models as the model catalog at start', async () => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      client.provider.list.mockReturnValue({
        data: {
          all: [
            {
              id: 'openai',
              name: 'OpenAI',
              source: 'env',
              models: { 'gpt-5.4': { name: 'GPT-5.4' }, 'gpt-5-nano': { name: '' } },
            },
            { id: 'opencode', name: 'opencode', source: 'api', models: { grok: { name: 'Grok' } } },
            {
              id: 'anthropic',
              name: 'Anthropic',
              source: 'config',
              models: { claude: { name: 'Claude' } },
            },
          ],
          default: {},
          connected: ['openai'],
        },
      });
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    const { events } = await makeAdapter();

    const catalogs = events.filter(
      (e): e is Extract<AgentEvent, { type: 'available-models-update' }> =>
        e.type === 'available-models-update',
    );
    expect(catalogs).toHaveLength(1);
    // Connected (openai) and key-less api-source (opencode) providers are in; the configured but
    // unconnected provider (anthropic) is out. A model with no display name falls back to its id.
    expect(catalogs[0].models).toEqual([
      { id: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
      { id: 'openai/gpt-5-nano', label: 'gpt-5-nano', description: 'OpenAI' },
      { id: 'opencode/grok', label: 'Grok', description: 'opencode' },
    ]);
  });

  it('narrows the model catalog to the credential-injected provider', async () => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      client.provider.list.mockReturnValue({
        data: {
          all: [
            {
              id: 'openai',
              name: 'OpenAI',
              source: 'env',
              models: { 'gpt-5.4': { name: 'GPT-5.4' } },
            },
            { id: 'opencode', name: 'opencode', source: 'api', models: { grok: { name: 'Grok' } } },
          ],
          default: {},
          connected: ['openai', 'opencode'],
        },
      });
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    const adapter = new OpenCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({
      kind: 'opencode',
      cwd: '/tmp/repo',
      model: 'openai/gpt-5.4',
      config: { apiKey: 'sk-test' },
    });

    const catalogs = events.filter(
      (e): e is Extract<AgentEvent, { type: 'available-models-update' }> =>
        e.type === 'available-models-update',
    );
    expect(catalogs).toHaveLength(1);
    // Only the injected provider's models: everything else would be rejected by the
    // cross-provider set-model guard anyway.
    expect(catalogs[0].models).toEqual([
      { id: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
    ]);
  });

  it('advertises no model catalog when provider.list fails', async () => {
    sdkMock.createOpencode = () => {
      client = new FakeClient();
      client.provider.list.mockReturnValue({ error: { message: 'boom' } } as never);
      return Promise.resolve({ client, server: { url: 'http://fake', close: closeServer } });
    };
    const { events } = await makeAdapter();

    expect(events.some((e) => e.type === 'available-models-update')).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.status === 'idle')).toBe(true);
  });

  it('reflects a configured start model before the first turn', async () => {
    const adapter = new OpenCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({ kind: 'opencode', cwd: '/tmp/repo', model: 'openai/gpt-5.5' });

    expect(events.some((e) => e.type === 'model-update' && e.model === 'openai/gpt-5.5')).toBe(
      true,
    );
  });
});
