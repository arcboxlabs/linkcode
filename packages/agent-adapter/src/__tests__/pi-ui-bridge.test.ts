import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

const FAKE_MODEL = { provider: 'openai', id: 'gpt-test', reasoning: true };

const sdkMock = vi.hoisted(() => ({
  createAgentSession: null as null | ((opts: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession(opts: Record<string, unknown>) {
    if (!sdkMock.createAgentSession) throw new Error('createAgentSession mock not installed');
    return sdkMock.createAgentSession(opts);
  },
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  ModelRegistry: {
    create: () => ({
      getAvailable: () => [FAKE_MODEL],
      find: () => FAKE_MODEL,
      registerProvider: vi.fn(),
    }),
  },
  DefaultResourceLoader: class {
    reload() {
      return Promise.resolve();
    }
  },
}));

interface FakeBindings {
  uiContext: ExtensionUIContext;
  mode: string;
  onError: (err: { extensionPath: string; event: string; error: string }) => void;
}

class FakeSession {
  bindings: FakeBindings | null = null;
  isStreaming = false;
  prompt = vi.fn<(text: string, opts?: unknown) => Promise<void>>(asyncNoop);
  abort = vi.fn(asyncNoop);
  dispose = vi.fn();
  private readonly listeners: Array<(ev: unknown) => void> = [];

  bindExtensions = vi.fn((bindings: FakeBindings) => {
    this.bindings = bindings;
    return Promise.resolve();
  });

  subscribe(listener: (ev: unknown) => void): () => void {
    this.listeners.push(listener);
    return noop;
  }

  feed(ev: unknown): void {
    for (const listener of this.listeners) listener(ev);
  }
}

function questionAsks(events: AgentEvent[]) {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'question-request' }> => e.type === 'question-request',
  );
}
function errors(events: AgentEvent[]) {
  return events.filter((e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error');
}
function statuses(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'status' ? [e.status] : []));
}
function stops(events: AgentEvent[]) {
  return events.filter((e): e is Extract<AgentEvent, { type: 'stop' }> => e.type === 'stop');
}

async function startedAdapter() {
  const session = new FakeSession();
  sdkMock.createAgentSession = () => Promise.resolve({ session });
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi-test' });
  const bindings = session.bindings;
  if (!bindings) throw new Error('bindExtensions was not called');
  return { adapter, session, events, bindings };
}

async function answer(
  adapter: PiAdapter,
  events: AgentEvent[],
  reply: { selectedOptionIds: string[]; customText?: string } | 'cancel',
) {
  await vi.waitFor(() => {
    expect(questionAsks(events).length).toBeGreaterThan(0);
  });
  const ask = questionAsks(events).at(-1)!;
  const question = ask.questions[0];
  await adapter.send({
    type: 'question-response',
    requestId: ask.requestId,
    outcome:
      reply === 'cancel'
        ? { outcome: 'cancelled' }
        : { outcome: 'answered', answers: [{ questionId: question.questionId, ...reply }] },
  });
}

beforeEach(() => {
  sdkMock.createAgentSession = null;
});

describe('pi extension UI bridge', () => {
  it('binds a ui context in rpc mode at start', async () => {
    const { bindings } = await startedAdapter();
    expect(bindings.mode).toBe('rpc');
    expect(typeof bindings.uiContext.select).toBe('function');
    expect(typeof bindings.onError).toBe('function');
  });

  it('select round-trips through the question ask', async () => {
    const { adapter, events, bindings } = await startedAdapter();
    const picked = bindings.uiContext.select('pick one', ['a', 'b']);
    await answer(adapter, events, { selectedOptionIds: ['1'] });
    await expect(picked).resolves.toBe('b');

    const ask = questionAsks(events)[0];
    expect(ask.questions).toHaveLength(1);
    expect(ask.questions[0]).toMatchObject({
      prompt: 'pick one',
      multiSelect: false,
      options: [
        { optionId: '0', label: 'a' },
        { optionId: '1', label: 'b' },
      ],
    });
  });

  it('select maps a cancel to undefined and free text to the typed answer', async () => {
    const { adapter, events, bindings } = await startedAdapter();

    const cancelled = bindings.uiContext.select('pick', ['a']);
    await answer(adapter, events, 'cancel');
    await expect(cancelled).resolves.toBeUndefined();

    const typed = bindings.uiContext.select('pick', ['a']);
    await answer(adapter, events, { selectedOptionIds: [], customText: 'my own' });
    await expect(typed).resolves.toBe('my own');
  });

  it('select resolves immediately for an empty option list without asking', async () => {
    const { events, bindings } = await startedAdapter();
    await expect(bindings.uiContext.select('pick', [])).resolves.toBeUndefined();
    expect(questionAsks(events)).toHaveLength(0);
  });

  it('confirm maps Yes to true and a cancel to false', async () => {
    const { adapter, events, bindings } = await startedAdapter();

    const confirmed = bindings.uiContext.confirm('Deploy?', 'to prod');
    await answer(adapter, events, { selectedOptionIds: ['yes'] });
    await expect(confirmed).resolves.toBe(true);
    expect(questionAsks(events)[0].questions[0].prompt).toBe('Deploy?\n\nto prod');

    const declined = bindings.uiContext.confirm('Deploy?', 'to prod');
    await answer(adapter, events, 'cancel');
    await expect(declined).resolves.toBe(false);
  });

  it('input returns typed text, and undefined when skipped', async () => {
    const { adapter, events, bindings } = await startedAdapter();

    const typed = bindings.uiContext.input('name?', 'your name');
    await answer(adapter, events, { selectedOptionIds: [], customText: 'ryo' });
    await expect(typed).resolves.toBe('ryo');
    expect(questionAsks(events)[0].questions[0].options[0]).toMatchObject({
      optionId: 'skip',
      description: 'your name',
    });

    const skipped = bindings.uiContext.input('name?');
    await answer(adapter, events, { selectedOptionIds: ['skip'] });
    await expect(skipped).resolves.toBeUndefined();
  });

  it('honors the dialog abort signal with the default value', async () => {
    const { events, bindings } = await startedAdapter();

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      bindings.uiContext.select('pick', ['a'], { signal: aborted.signal }),
    ).resolves.toBeUndefined();
    expect(questionAsks(events)).toHaveLength(0);

    const controller = new AbortController();
    const pending = bindings.uiContext.confirm('sure?', '', { signal: controller.signal });
    await vi.waitFor(() => {
      expect(questionAsks(events)).toHaveLength(1);
    });
    controller.abort();
    await expect(pending).resolves.toBe(false);
  });

  it('resolves a dialog with its default when the timeout elapses', async () => {
    const { bindings } = await startedAdapter();
    await expect(
      bindings.uiContext.input('name?', undefined, { timeout: 5 }),
    ).resolves.toBeUndefined();
  });

  it('cancel sweeps a pending dialog to its default via teardown', async () => {
    const { adapter, events, bindings } = await startedAdapter();
    const pending = bindings.uiContext.select('pick', ['a', 'b']);
    await vi.waitFor(() => {
      expect(questionAsks(events)).toHaveLength(1);
    });
    await adapter.send({ type: 'cancel' });
    await expect(pending).resolves.toBeUndefined();
  });

  it('surfaces extension errors and error notifications as error events', async () => {
    const { events, bindings } = await startedAdapter();

    bindings.onError({ extensionPath: '<inline:1>', event: 'tool_call', error: 'boom' });
    expect(errors(events).at(-1)).toMatchObject({
      message: 'pi: extension error (<inline:1>): boom',
      code: 'extension-error',
      recoverable: true,
    });

    bindings.uiContext.notify('bad thing', 'error');
    expect(errors(events).at(-1)!.message).toBe('pi: bad thing');

    bindings.uiContext.notify('fyi', 'info');
    expect(errors(events)).toHaveLength(2);
  });
});

describe('pi turn lifecycle', () => {
  it('emits idle before rejecting when the prompt preflight fails', async () => {
    const { adapter, session, events } = await startedAdapter();
    session.prompt.mockRejectedValueOnce(new Error('No API key found'));
    events.length = 0;

    await expect(
      adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] }),
    ).rejects.toThrow('No API key found');
    expect(statuses(events)).toEqual(['running', 'idle']);
  });

  it('maps agent_end stop reasons and surfaces run errors', async () => {
    const { adapter: _adapter, session, events } = await startedAdapter();

    session.feed({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'stop' }] });
    expect(stops(events).at(-1)!.stopReason).toBe('end_turn');

    session.feed({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'aborted' }] });
    expect(stops(events).at(-1)!.stopReason).toBe('cancelled');

    events.length = 0;
    session.feed({
      type: 'agent_end',
      messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' }],
    });
    expect(stops(events)).toHaveLength(0);
    expect(errors(events).at(-1)!.message).toBe('pi: rate limited');
    expect(statuses(events)).toEqual(['idle']);
  });
});
