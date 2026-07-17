import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop } from 'foxts/noop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

interface FakePiModel {
  provider: string;
  id: string;
  name?: string;
  reasoning: boolean;
}

const OPENAI_MODEL: FakePiModel = {
  provider: 'openai',
  id: 'gpt-test',
  name: 'GPT Test',
  reasoning: true,
};
const ANTHROPIC_MODEL: FakePiModel = { provider: 'anthropic', id: 'claude-x', reasoning: true };

const sdkMock = vi.hoisted(() => ({
  available: [] as unknown[],
  session: null as Record<string, unknown> | null,
}));

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const { asyncNoop, noop: noopFn } = await import('foxts/noop');
  return {
    createAgentSession: () =>
      Promise.resolve({
        session: sdkMock.session ?? {
          isStreaming: false,
          sessionId: 'sess-1',
          model: undefined,
          thinkingLevel: 'medium',
          prompt: asyncNoop,
          abort: asyncNoop,
          dispose: noopFn,
          bindExtensions: asyncNoop,
          subscribe: () => noopFn,
          supportsThinking: () => true,
          setThinkingLevel: noopFn,
          setModel: asyncNoop,
        },
      }),
    AuthStorage: { create: () => ({ setRuntimeApiKey: noopFn }) },
    ModelRegistry: {
      create: () => ({
        getAvailable: () => sdkMock.available,
        find: (provider: string, id: string) =>
          (sdkMock.available as FakePiModel[]).find((m) => m.provider === provider && m.id === id),
        registerProvider: noopFn,
      }),
    },
    DefaultResourceLoader: class {
      reload() {
        return Promise.resolve();
      }
    },
  };
});

function catalogs(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'available-models-update' ? [e.models] : []));
}
function modelUpdates(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'model-update' ? [e.model] : []));
}
function effortUpdates(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'effort-update' ? [e.effort] : []));
}

interface FakeSessionState {
  model: FakePiModel | undefined;
  thinkingLevel: string;
  supportsThinking: boolean;
}

function makeSession(state: FakeSessionState) {
  return {
    isStreaming: false,
    sessionId: 'sess-1',
    get model() {
      return state.model;
    },
    get thinkingLevel() {
      return state.thinkingLevel;
    },
    prompt: vi.fn(asyncNoop),
    abort: vi.fn(asyncNoop),
    dispose: vi.fn(),
    bindExtensions: vi.fn(asyncNoop),
    subscribe: vi.fn(() => vi.fn()),
    supportsThinking: () => state.supportsThinking,
    setThinkingLevel: vi.fn((level: string) => {
      // Mirror the SDK clamp: xhigh unsupported on this fake model, clamps to high.
      state.thinkingLevel = level === 'xhigh' ? 'high' : level;
    }),
    setModel: vi.fn((model: FakePiModel) => {
      state.model = model;
      // Mirror the SDK: switching models re-clamps the thinking level to the new model's range.
      if (!model.reasoning) state.thinkingLevel = 'off';
      else if (model.id === 'claude-x') state.thinkingLevel = 'low';
      return Promise.resolve();
    }),
  };
}

async function startedAdapter(state: FakeSessionState, startOpts: Record<string, unknown> = {}) {
  const session = makeSession(state);
  sdkMock.session = session;
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi-test', ...startOpts });
  return { adapter, events, session, state };
}

beforeEach(() => {
  sdkMock.available = [OPENAI_MODEL, ANTHROPIC_MODEL];
  sdkMock.session = null;
});

describe('pi dynamic model catalog', () => {
  it('advertises the available models at start and reflects the running model/effort', async () => {
    const { events } = await startedAdapter({
      model: OPENAI_MODEL,
      thinkingLevel: 'medium',
      supportsThinking: true,
    });

    expect(catalogs(events)).toHaveLength(1);
    expect(catalogs(events)[0]).toEqual([
      { id: 'openai/gpt-test', label: 'GPT Test', description: 'openai/gpt-test' },
      { id: 'anthropic/claude-x', label: 'claude-x', description: 'anthropic/claude-x' },
    ]);
    expect(modelUpdates(events)).toEqual(['openai/gpt-test']);
    expect(effortUpdates(events)).toEqual(['medium']);
  });

  it('narrows the catalog to the credential provider and rejects cross-provider switches', async () => {
    const { adapter, events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { model: 'openai/gpt-test', config: { apiKey: 'sk-1' } },
    );

    expect(catalogs(events)[0].map((m) => m.id)).toEqual(['openai/gpt-test']);
    await expect(adapter.send({ type: 'set-model', model: 'anthropic/claude-x' })).rejects.toThrow(
      "credential is scoped to 'openai'",
    );
  });

  it('emits no catalog when nothing is available', async () => {
    sdkMock.available = [];
    const { events } = await startedAdapter({
      model: undefined,
      thinkingLevel: 'off',
      supportsThinking: false,
    });
    expect(catalogs(events)).toHaveLength(0);
    expect(modelUpdates(events)).toHaveLength(0);
    expect(effortUpdates(events)).toHaveLength(0);
  });
});

describe('pi set-model', () => {
  it('switches live via session.setModel and reflects model + re-clamped effort', async () => {
    const { adapter, events, session } = await startedAdapter({
      model: OPENAI_MODEL,
      thinkingLevel: 'medium',
      supportsThinking: true,
    });
    events.length = 0;

    await adapter.send({ type: 'set-model', model: 'anthropic/claude-x' });
    expect(session.setModel).toHaveBeenCalledWith(ANTHROPIC_MODEL);
    expect(modelUpdates(events)).toEqual(['anthropic/claude-x']);
    // The fake clamps to 'low' on switch; the adapter reflects the readback.
    expect(effortUpdates(events)).toEqual(['low']);
  });

  it('rejects a bare ref and an unknown model without emitting', async () => {
    const { adapter, events } = await startedAdapter({
      model: OPENAI_MODEL,
      thinkingLevel: 'medium',
      supportsThinking: true,
    });
    events.length = 0;

    await expect(adapter.send({ type: 'set-model', model: 'gpt-test' })).rejects.toThrow(
      "pi: model must be 'provider/modelId'",
    );
    await expect(adapter.send({ type: 'set-model', model: 'openai/nope' })).rejects.toThrow(
      "pi: unknown model 'openai/nope'",
    );
    expect(modelUpdates(events)).toHaveLength(0);
  });

  it('propagates a setModel auth failure without reflecting the model', async () => {
    const { adapter, events, session } = await startedAdapter({
      model: OPENAI_MODEL,
      thinkingLevel: 'medium',
      supportsThinking: true,
    });
    session.setModel.mockRejectedValueOnce(new Error('No auth configured for anthropic'));
    events.length = 0;

    await expect(adapter.send({ type: 'set-model', model: 'anthropic/claude-x' })).rejects.toThrow(
      'No auth configured',
    );
    expect(modelUpdates(events)).toHaveLength(0);
  });
});

describe('pi set-effort', () => {
  it('switches live and reflects the SDK clamp readback', async () => {
    const { adapter, events, session } = await startedAdapter({
      model: OPENAI_MODEL,
      thinkingLevel: 'medium',
      supportsThinking: true,
    });
    events.length = 0;

    await adapter.send({ type: 'set-effort', effort: 'high' });
    expect(session.setThinkingLevel).toHaveBeenCalledWith('high');
    expect(effortUpdates(events)).toEqual(['high']);

    // The fake clamps xhigh → high; the reflect reports what actually applied. `emitEffort`
    // dedupes, so an identical readback produces no second event.
    await adapter.send({ type: 'set-effort', effort: 'xhigh' });
    expect(effortUpdates(events)).toEqual(['high']);
  });

  it('rejects claude-only levels and non-reasoning models', async () => {
    const { adapter } = await startedAdapter({
      model: OPENAI_MODEL,
      thinkingLevel: 'medium',
      supportsThinking: true,
    });
    await expect(adapter.send({ type: 'set-effort', effort: 'max' })).rejects.toThrow(
      "pi: effort 'max' is not supported",
    );

    const nonReasoning = await startedAdapter({
      model: { provider: 'openai', id: 'basic', reasoning: false },
      thinkingLevel: 'off',
      supportsThinking: false,
    });
    await expect(nonReasoning.adapter.send({ type: 'set-effort', effort: 'high' })).rejects.toThrow(
      'does not support a reasoning-effort level',
    );
  });
});
