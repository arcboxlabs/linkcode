import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asHistoryId } from '../history-util';
import { PiAdapter } from '../native/pi';

interface Model {
  provider: string;
  id: string;
  name?: string;
  reasoning: boolean;
  thinkingLevelMap?: Record<string, string | null>;
}
const sdk = vi.hoisted(() => ({
  models: [] as Model[],
  createOptions: null as Record<string, unknown> | null,
  open: vi.fn(),
  registerProvider: vi.fn(),
  session: null as Record<string, unknown> | null,
  setRuntimeApiKey: vi.fn(),
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: { create: () => ({ setRuntimeApiKey: sdk.setRuntimeApiKey }) },
  ModelRegistry: {
    create: () => ({
      find: (provider: string, id: string) =>
        sdk.models.find((m) => m.provider === provider && m.id === id),
      getAvailable: () => sdk.models,
      registerProvider: sdk.registerProvider,
    }),
  },
  DefaultResourceLoader: class {
    reload = vi.fn();
  },
  SessionManager: { open: sdk.open, list: vi.fn(), listAll: vi.fn() },
  createAgentSession(options: Record<string, unknown>) {
    sdk.createOptions = options;
    return Promise.resolve({ session: sdk.session });
  },
}));

function makeSession(initial: Model) {
  const state = { model: initial, effort: 'medium' };
  return {
    abort: asyncNoop,
    bindExtensions: asyncNoop,
    dispose: noop,
    isStreaming: false,
    get model() {
      return state.model;
    },
    prompt: asyncNoop,
    sessionId: 'session',
    setModel: vi.fn(function setModel(model: Model) {
      state.model = model;
      state.effort = 'low';
      return Promise.resolve();
    }),
    setThinkingLevel: vi.fn((effort: string) => {
      state.effort = effort;
    }),
    subscribe: () => noop,
    supportsThinking: () => state.model.reasoning,
    get thinkingLevel() {
      return state.effort;
    },
  };
}
function modelValues(events: AgentEvent[]) {
  return events.flatMap((event) => (event.type === 'model-update' ? [event.model] : []));
}
function effortValues(events: AgentEvent[]) {
  return events.flatMap((event) => (event.type === 'effort-update' ? [event.effort] : []));
}
async function start(options: Record<string, unknown> = {}) {
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((event) => events.push(event));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi', ...options });
  return { adapter, events };
}

beforeEach(() => {
  sdk.models = [
    {
      provider: 'openai',
      id: 'gpt',
      name: 'GPT',
      reasoning: true,
      thinkingLevelMap: { xhigh: 'xhigh' },
    },
    {
      provider: 'other',
      id: 'nulls',
      reasoning: true,
      thinkingLevelMap: { low: null, medium: null, high: 'high', xhigh: null },
    },
  ];
  sdk.session = makeSession(sdk.models[0]);
  sdk.createOptions = null;
  sdk.open.mockReset();
  sdk.registerProvider.mockReset();
  sdk.setRuntimeApiKey.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('Pi dynamic model catalog', () => {
  it('reports per-model effort metadata, explicit null maps/xhigh, and startCatalog policies', async () => {
    const catalog = await new PiAdapter().startCatalog();
    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: 'openai/gpt',
        effortLevels: ['low', 'medium', 'high', 'xhigh'],
      }),
      expect.objectContaining({ id: 'other/nulls', effortLevels: ['high'] }),
    ]);
    expect(catalog.policies.map((policy) => policy.policyId)).toEqual([
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
    expect(catalog.defaultPolicyId).toBe('default');
  });

  it('applies LinkCode account credentials before enumerating the catalog', async () => {
    const catalog = await new PiAdapter().startCatalog({
      model: 'openai/gpt',
      config: { apiKey: 'account-key', baseUrl: 'https://gateway.example.test/v1' },
    });

    expect(sdk.setRuntimeApiKey).toHaveBeenCalledWith('openai', 'account-key');
    expect(sdk.registerProvider).toHaveBeenCalledWith('openai', {
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'account-key',
    });
    expect(catalog.models).toContainEqual(expect.objectContaining({ id: 'openai/gpt' }));
  });

  it('switches model and effort live and reflects SDK readback', async () => {
    const { adapter, events } = await start();
    events.length = 0;
    await adapter.send({ type: 'set-model', model: 'other/nulls' });
    await adapter.send({ type: 'set-effort', effort: 'high' });
    expect(modelValues(events)).toEqual(['other/nulls']);
    expect(effortValues(events)).toEqual(['low', 'high']);
  });

  it('hard-fails a selected missing startup model without fallback', async () => {
    await expect(start({ model: 'openai/missing' })).rejects.toThrow(
      "pi: model 'openai/missing' is not available for provider 'openai'",
    );
    expect(sdk.createOptions).toBeNull();
  });

  it('preserves an explicit null model reset for the Pi provider default', async () => {
    await start({ model: null });
    expect(sdk.createOptions).not.toHaveProperty('model');
  });
});

describe('Pi native resume', () => {
  it('opens the exact resolved path and passes that sessionManager', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-resume-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', root);
    mkdirSync(join(root, 'sessions', 'slug'), { recursive: true });
    const file = join(root, 'sessions', 'slug', '2026_resume-id.jsonl');
    writeFileSync(file, '');
    const manager = { getBranch: () => [], getCwd: () => '/saved/cwd' };
    sdk.open.mockReturnValue(manager);
    const adapter = new PiAdapter();
    adapter.onEvent(noop);
    await adapter.resumeHistory(
      { historyId: asHistoryId('resume-id') },
      { kind: 'pi', cwd: '/caller' },
    );
    expect(sdk.open).toHaveBeenCalledWith(file);
    expect(sdk.createOptions).toMatchObject({ cwd: '/saved/cwd', sessionManager: manager });
  });
});
