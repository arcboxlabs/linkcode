import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

const sdk = vi.hoisted(() => ({
  bindings: null as {
    uiContext: ExtensionUIContext;
    onError: (e: { extensionPath: string; error: string }) => void;
  } | null,
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  ModelRegistry: {
    create: () => ({
      find: vi.fn(),
      getAvailable: () => [{ provider: 'p', id: 'm', reasoning: false }],
      registerProvider: vi.fn(),
    }),
  },
  DefaultResourceLoader: class {
    reload = vi.fn();
  },
  createAgentSession: () =>
    Promise.resolve({
      session: {
        abort: asyncNoop,
        dispose: vi.fn(),
        isStreaming: false,
        model: { provider: 'p', id: 'm' },
        prompt: asyncNoop,
        sessionId: 's',
        subscribe: () => noop,
        thinkingLevel: 'off',
        bindExtensions(bindings: NonNullable<typeof sdk.bindings>) {
          sdk.bindings = bindings;
          return Promise.resolve();
        },
      },
    }),
}));

function questions(events: AgentEvent[]) {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'question-request' }> => e.type === 'question-request',
  );
}
async function setup() {
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((event) => events.push(event));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi' });
  if (!sdk.bindings) throw new Error('extensions not bound');
  return { adapter, events, bindings: sdk.bindings };
}
async function answer(
  adapter: PiAdapter,
  events: AgentEvent[],
  selectedOptionIds: string[],
  customText?: string,
) {
  await vi.waitFor(() => expect(questions(events)).not.toHaveLength(0));
  const request = questions(events).at(-1)!;
  await adapter.send({
    type: 'question-response',
    requestId: request.requestId,
    outcome: {
      outcome: 'answered',
      answers: [{ questionId: request.questions[0].questionId, selectedOptionIds, customText }],
    },
  });
}

beforeEach(() => {
  sdk.bindings = null;
});

describe('Pi extension UI bridge', () => {
  it('round-trips select, input, confirm, and editor', async () => {
    const { adapter, events, bindings } = await setup();
    const selected = bindings.uiContext.select('Pick', ['a', 'b']);
    await answer(adapter, events, ['1']);
    await expect(selected).resolves.toBe('b');
    const input = bindings.uiContext.input('Name', 'placeholder');
    await answer(adapter, events, [], ' Ada ');
    await expect(input).resolves.toBe('Ada');
    const confirmed = bindings.uiContext.confirm('Deploy?', 'Now');
    await answer(adapter, events, ['yes']);
    await expect(confirmed).resolves.toBe(true);
    const edited = bindings.uiContext.editor('Edit', 'prefill');
    await answer(adapter, events, [], 'changed');
    await expect(edited).resolves.toBe('changed');
    expect(questions(events).map((event) => event.questions[0].questionId)).toEqual([
      'select',
      'input',
      'confirm',
      'input',
    ]);
  });

  it.each(['abort', 'timeout'] as const)('%s emits one canonical resolution', async (kind) => {
    const { events, bindings } = await setup();
    const controller = new AbortController();
    const pending = bindings.uiContext.input(
      'Name',
      undefined,
      kind === 'abort' ? { signal: controller.signal } : { timeout: 1 },
    );
    await vi.waitFor(() => expect(questions(events)).toHaveLength(1));
    if (kind === 'abort') controller.abort();
    await expect(pending).resolves.toBeUndefined();
    const requestId = questions(events)[0].requestId;
    expect(
      events.filter((event) => event.type === 'question-resolved' && event.requestId === requestId),
    ).toEqual([
      {
        type: 'question-resolved',
        requestId,
        outcome: { outcome: 'cancelled' },
        source: 'session',
      },
    ]);
  });

  it('teardown resolves dialogs and suppresses late extension notifications', async () => {
    const { adapter, events, bindings } = await setup();
    const pending = bindings.uiContext.select('Pick', ['a']);
    await vi.waitFor(() => expect(questions(events)).toHaveLength(1));
    await adapter.stop();
    await expect(pending).resolves.toBeUndefined();
    const count = events.length;
    bindings.uiContext.notify('late', 'error');
    bindings.onError({ extensionPath: 'late.ts', error: 'late' });
    expect(events).toHaveLength(count);
  });
});
