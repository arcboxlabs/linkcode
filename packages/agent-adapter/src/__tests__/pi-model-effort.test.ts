import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop } from 'foxts/noop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

interface FakePiModel {
  provider: string;
  id: string;
  name?: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  baseUrl?: string;
}

const OPENAI_MODEL: FakePiModel = {
  provider: 'openai',
  id: 'gpt-test',
  name: 'GPT Test',
  reasoning: true,
  // xhigh counts as supported only when explicitly mapped (pi-ai getSupportedThinkingLevels).
  thinkingLevelMap: { xhigh: 'xhigh' },
};
const ANTHROPIC_MODEL: FakePiModel = { provider: 'anthropic', id: 'claude-x', reasoning: true };

const sdkMock = vi.hoisted(() => ({
  available: [] as unknown[],
  session: null as Record<string, unknown> | null,
  createOpts: null as Record<string, unknown> | null,
  /** null = every model counts as available (auth not modeled); a Set gates `getAvailable` on the
   * providers it contains, mirroring the real registry's auth-gated availability view. */
  authedProviders: null as Set<string> | null,
  /** Providers whose models come from models.json — excluded from `inMemory`'s built-in view,
   * mirroring the double-registry diff `piLocalProviders` performs. null = none local. */
  localProviders: null as Set<string> | null,
  /** `registerProvider(name, config)` calls, for the endpoint-protection assertions. */
  registered: [] as Array<[string, Record<string, unknown>]>,
}));

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const { asyncNoop, noop: noopFn } = await import('foxts/noop');
  return {
    createAgentSession(opts: Record<string, unknown>) {
      sdkMock.createOpts = opts;
      return Promise.resolve({
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
      });
    },
    AuthStorage: {
      create: () => ({
        setRuntimeApiKey(provider: string) {
          sdkMock.authedProviders?.add(provider);
        },
      }),
    },
    ModelRegistry: {
      create: () => ({
        authStorage: {},
        getAll: () => sdkMock.available,
        getAvailable: () =>
          sdkMock.authedProviders
            ? (sdkMock.available as FakePiModel[]).filter((m) =>
                sdkMock.authedProviders?.has(m.provider),
              )
            : sdkMock.available,
        // find is deliberately NOT auth-gated, matching the real registry.
        find: (provider: string, id: string) =>
          (sdkMock.available as FakePiModel[]).find((m) => m.provider === provider && m.id === id),
        registerProvider(name: string, config: Record<string, unknown>) {
          sdkMock.registered.push([name, config]);
          // Mirror the SDK: a models-carrying registration replaces the provider's models and
          // its inline apiKey makes the provider count as authed.
          const models = config.models as FakePiModel[] | undefined;
          if (models) {
            sdkMock.available = [
              ...(sdkMock.available as FakePiModel[]).filter((m) => m.provider !== name),
              ...models.map((m) => ({ ...m, provider: name })),
            ];
            sdkMock.authedProviders?.add(name);
          }
        },
      }),
      // The models.json-less registry piLocalProviders diffs against: built-in models only.
      inMemory: () => ({
        getAll: () =>
          (sdkMock.available as FakePiModel[]).filter(
            (m) => !sdkMock.localProviders?.has(m.provider),
          ),
      }),
    },
    DefaultResourceLoader: class {
      reload() {
        return Promise.resolve();
      }
      getSkills() {
        return { skills: [], diagnostics: [] };
      }
      getPrompts() {
        return { prompts: [], diagnostics: [] };
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
  sdkMock.createOpts = null;
  sdkMock.authedProviders = null;
  sdkMock.localProviders = null;
  sdkMock.registered = [];
});

describe('pi startCatalog', () => {
  it('serves models and policy tiers from a never-started instance', async () => {
    const adapter = new PiAdapter();
    const catalog = await adapter.startCatalog({});

    expect(catalog.models.map((m) => m.id)).toEqual(['openai/gpt-test', 'anthropic/claude-x']);
    expect(catalog.models[0].effortLevels).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(catalog.policies.map((p) => p.policyId)).toEqual([
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
    expect(catalog.defaultPolicyId).toBe('default');
    // Never started: no events, no session.
    expect(sdkMock.createOpts).toBeNull();
  });
});

describe('pi local providers', () => {
  const BANNED_MODEL: FakePiModel = {
    provider: 'banned',
    id: 'glm',
    reasoning: false,
    baseUrl: 'https://banned.test/v1',
  };

  it('reports models.json providers in the start catalog', async () => {
    sdkMock.available = [OPENAI_MODEL, BANNED_MODEL];
    sdkMock.localProviders = new Set(['banned']);
    const adapter = new PiAdapter();
    const catalog = await adapter.startCatalog({});

    expect(catalog.localProviders).toEqual([
      { id: 'banned', baseUrl: 'https://banned.test/v1', models: ['glm'] },
    ]);
  });

  it('omits localProviders when models.json defines none', async () => {
    const adapter = new PiAdapter();
    const catalog = await adapter.startCatalog({});
    expect(catalog.localProviders).toBeUndefined();
  });

  it('never overrides a models.json provider endpoint with the bound account baseUrl', async () => {
    sdkMock.available = [BANNED_MODEL];
    sdkMock.localProviders = new Set(['banned']);
    await startedAdapter(
      { model: BANNED_MODEL, thinkingLevel: 'off', supportsThinking: false },
      { model: 'banned/glm', config: { apiKey: 'sk-1', baseUrl: 'https://gateway.test/v1' } },
    );
    expect(sdkMock.registered).toEqual([]);
  });

  it('registers an account-defined provider with its models and defaults inside it', async () => {
    // Fresh machine: nothing is authed until the account's registration lands.
    sdkMock.authedProviders = new Set();
    const { events } = await startedAdapter(
      { model: undefined, thinkingLevel: 'off', supportsThinking: false },
      {
        config: {
          apiKey: 'sk-1',
          baseUrl: 'https://banned.test/v1',
          protocol: 'openai-chat',
          customProvider: {
            name: 'banned',
            models: [{ id: '@cf/glm', contextWindow: 262144, maxTokens: 16384 }],
          },
        },
      },
    );

    expect(sdkMock.registered).toEqual([
      [
        'banned',
        {
          baseUrl: 'https://banned.test/v1',
          apiKey: 'sk-1',
          api: 'openai-completions',
          models: [
            {
              id: '@cf/glm',
              name: '@cf/glm',
              reasoning: false,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 262144,
              maxTokens: 16384,
            },
          ],
        },
      ],
    ]);
    expect(sdkMock.createOpts?.model).toMatchObject({ provider: 'banned', id: '@cf/glm' });
    expect(catalogs(events)[0].map((m) => m.id)).toEqual(['banned/@cf/glm']);
  });

  it('degrades an account-defined provider missing its protocol with an error event', async () => {
    await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      {
        config: {
          apiKey: 'sk-1',
          baseUrl: 'https://banned.test/v1',
          customProvider: {
            name: 'banned',
            models: [{ id: '@cf/glm', contextWindow: 262144, maxTokens: 16384 }],
          },
        },
      },
    ).then(({ events }) => {
      const messages = events.flatMap((e) => (e.type === 'error' ? [e.message] : []));
      expect(messages).toContainEqual(
        "pi: custom provider 'banned' needs an endpoint URL, a key, and a protocol — its models are unavailable",
      );
      expect(sdkMock.registered).toEqual([]);
    });
  });

  it('registers the account baseUrl onto a non-local provider', async () => {
    await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { model: 'openai/gpt-test', config: { apiKey: 'sk-1', baseUrl: 'https://gateway.test/v1' } },
    );
    expect(sdkMock.registered).toEqual([
      ['openai', { baseUrl: 'https://gateway.test/v1', apiKey: 'sk-1' }],
    ]);
  });
});

describe('pi start-time picks', () => {
  it('applies an initial effort and approval tier at session creation', async () => {
    const { events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'high', supportsThinking: true },
      { effort: 'high', approvalPolicyId: 'bypassPermissions' },
    );

    expect(sdkMock.createOpts).toMatchObject({ thinkingLevel: 'high' });
    const policy = events.findLast((e) => e.type === 'approval-policy-update');
    expect(policy).toMatchObject({ state: { currentPolicyId: 'bypassPermissions' } });
  });

  it('degrades invalid initial picks with error events instead of failing start', async () => {
    const { events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { effort: 'max', approvalPolicyId: 'plan' },
    );

    expect(sdkMock.createOpts).not.toHaveProperty('thinkingLevel');
    const messages = events.flatMap((e) => (e.type === 'error' ? [e.message] : []));
    expect(messages).toContainEqual("pi: effort 'max' is not supported (low–xhigh only)");
    expect(messages).toContainEqual("pi: unknown approval policy 'plan' — using default");
    const policy = events.findLast((e) => e.type === 'approval-policy-update');
    expect(policy).toMatchObject({ state: { currentPolicyId: 'default' } });
  });
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
      {
        id: 'openai/gpt-test',
        label: 'GPT Test',
        description: 'openai/gpt-test',
        effortLevels: ['low', 'medium', 'high', 'xhigh'],
      },
      {
        id: 'anthropic/claude-x',
        label: 'claude-x',
        description: 'anthropic/claude-x',
        // No thinkingLevelMap: xhigh needs an explicit mapping, so this model caps at high.
        effortLevels: ['low', 'medium', 'high'],
      },
    ]);
    expect(modelUpdates(events)).toEqual(['openai/gpt-test']);
    expect(effortUpdates(events)).toEqual(['medium']);
  });

  it('excludes levels the model explicitly nulls in its thinkingLevelMap', async () => {
    sdkMock.available = [
      {
        provider: 'together',
        id: 'deep-x',
        reasoning: true,
        thinkingLevelMap: { low: null, medium: null, high: 'high', xhigh: null },
      },
    ];
    const { events } = await startedAdapter({
      model: sdkMock.available[0] as FakePiModel,
      thinkingLevel: 'high',
      supportsThinking: true,
    });
    expect(catalogs(events)[0][0].effortLevels).toEqual(['high']);
  });

  it('narrows the catalog to the credential provider and rejects switches to unauthed providers', async () => {
    // Nothing locally authed: the injected credential is the only auth in play.
    sdkMock.authedProviders = new Set();
    const { adapter, events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { model: 'openai/gpt-test', config: { apiKey: 'sk-1' } },
    );

    expect(catalogs(events)[0].map((m) => m.id)).toEqual(['openai/gpt-test']);
    await expect(adapter.send({ type: 'set-model', model: 'anthropic/claude-x' })).rejects.toThrow(
      "credential is scoped to 'openai'",
    );
  });

  it('keeps locally-authed providers visible and switchable alongside a bound credential', async () => {
    // anthropic authenticates through pi's own stores (auth.json / a models.json inline key);
    // only openai's auth arrives via the injected credential.
    sdkMock.authedProviders = new Set(['anthropic']);
    const { adapter, events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { model: 'openai/gpt-test', config: { apiKey: 'sk-1' } },
    );

    expect(catalogs(events)[0].map((m) => m.id)).toEqual(['openai/gpt-test', 'anthropic/claude-x']);
    await adapter.send({ type: 'set-model', model: 'anthropic/claude-x' });
    expect(modelUpdates(events)).toContain('anthropic/claude-x');
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

  it('advertises an empty effort set for a non-reasoning model', async () => {
    const basic = { provider: 'openai', id: 'basic', reasoning: false };
    sdkMock.available = [basic];
    const { events } = await startedAdapter({
      model: basic,
      thinkingLevel: 'off',
      supportsThinking: false,
    });

    expect(catalogs(events)[0]).toEqual([
      {
        id: 'openai/basic',
        label: 'basic',
        description: 'openai/basic',
        effortLevels: [],
      },
    ]);
  });

  it('degrades a stale explicit model to the provider default with an error event', async () => {
    const { events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { model: 'openai/missing' },
    );
    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({
      message: "pi: model 'openai/missing' is not available — using the default model",
      recoverable: true,
    });
    // Session creation still succeeded and the catalog is intact.
    expect(catalogs(events)).toHaveLength(1);
  });

  it('injects the credential before resolving availability (bootstrap on a fresh machine)', async () => {
    // No local auth at all: getAvailable() is empty until the runtime key lands.
    sdkMock.authedProviders = new Set();
    const { events } = await startedAdapter(
      { model: OPENAI_MODEL, thinkingLevel: 'medium', supportsThinking: true },
      { model: 'openai/gpt-test', config: { apiKey: 'sk-fresh' } },
    );

    // The provider was derived from the model STRING, the key injected, and the catalog then
    // resolved against the now-authed provider — the old order left all of this empty.
    expect(catalogs(events)).toHaveLength(1);
    expect(catalogs(events)[0].map((m) => m.id)).toEqual(['openai/gpt-test']);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
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
