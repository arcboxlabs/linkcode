import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asHistoryId } from '../history-util';
import { PiAdapter } from '../native/pi';

const FAKE_MODEL = { provider: 'openai', id: 'gpt-test', reasoning: true };

const sdkMock = vi.hoisted(() => ({
  createOpts: null as Record<string, unknown> | null,
  openedPaths: [] as string[],
  entries: [] as unknown[],
  setRuntimeApiKey: null as ((provider: string, key: string) => void) | null,
  find: null as ((provider: string, id: string) => unknown) | null,
  modelFallbackMessage: undefined as string | undefined,
}));

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const { asyncNoop, noop: noopFn } = await import('foxts/noop');
  class FakeSession {
    isStreaming = false;
    sessionId = 'fresh-session-id';
    prompt = asyncNoop;
    abort = asyncNoop;
    dispose = noopFn;
    bindExtensions = asyncNoop;
    private readonly listeners: Array<(ev: unknown) => void> = [];
    subscribe(listener: (ev: unknown) => void) {
      this.listeners.push(listener);
      return noopFn;
    }
    feed(ev: unknown) {
      for (const listener of this.listeners) listener(ev);
    }
  }
  return {
    createAgentSession(opts: Record<string, unknown>) {
      sdkMock.createOpts = opts;
      const session = new FakeSession();
      return Promise.resolve({
        session,
        modelFallbackMessage: sdkMock.modelFallbackMessage,
      });
    },
    AuthStorage: {
      create: () => ({
        setRuntimeApiKey(provider: string, key: string) {
          sdkMock.setRuntimeApiKey?.(provider, key);
        },
      }),
    },
    ModelRegistry: {
      create: () => ({
        getAvailable: () => [FAKE_MODEL],
        find(provider: string, id: string) {
          return sdkMock.find?.(provider, id);
        },
        registerProvider: noopFn,
      }),
    },
    SessionManager: {
      open(path: string) {
        sdkMock.openedPaths.push(path);
        return {
          getEntries: () => sdkMock.entries,
          getLeafId: () => null,
          getBranch: () => sdkMock.entries,
          getCwd: () => '/recorded/cwd',
        };
      },
    },
    buildContextEntries: (entries: unknown[]) => entries,
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

function sessionRefs(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'session-ref' ? [e.historyId] : []));
}

let agentDir: string;

beforeEach(() => {
  sdkMock.createOpts = null;
  sdkMock.openedPaths = [];
  sdkMock.entries = [];
  sdkMock.setRuntimeApiKey = null;
  sdkMock.find = null;
  sdkMock.modelFallbackMessage = undefined;
  agentDir = mkdtempSync(join(tmpdir(), 'pi-agent-'));
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function seedSessionFile(id: string): string {
  const dir = join(agentDir, 'sessions', '--x--');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `2026_${id}.jsonl`);
  writeFileSync(file, '');
  return file;
}

async function resume(id: string, startOpts: Record<string, unknown> = {}) {
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.resumeHistory(
    { historyId: asHistoryId(id) },
    { kind: 'pi', cwd: '/caller/cwd', ...startOpts },
  );
  return { adapter, events };
}

describe('pi resumeHistory', () => {
  it('reopens the session file, adopts its cwd, and lets the SDK restore the model', async () => {
    const file = seedSessionFile('res-1');
    const { events } = await resume('res-1');

    expect(sdkMock.openedPaths).toEqual([file]);
    expect(sdkMock.createOpts).toMatchObject({ cwd: '/recorded/cwd' });
    expect(sdkMock.createOpts).not.toHaveProperty('model');
    expect(sdkMock.createOpts).toHaveProperty('sessionManager');
    expect(sessionRefs(events)).toEqual(['res-1']);
  });

  it('honors an explicit StartOptions.model override on resume', async () => {
    seedSessionFile('res-2');
    const found = { provider: 'anthropic', id: 'claude-x', reasoning: true };
    sdkMock.find = vi.fn(() => found);

    await resume('res-2', { model: 'anthropic/claude-x' });
    expect(sdkMock.find).toHaveBeenCalledWith('anthropic', 'claude-x');
    expect(sdkMock.createOpts).toMatchObject({ model: found });
  });

  it('degrades an unavailable explicit model to the saved model with an error event', async () => {
    seedSessionFile('res-missing-model');
    sdkMock.find = vi.fn(noop);
    const setKey = vi.fn();
    sdkMock.setRuntimeApiKey = setKey;

    const { events } = await resume('res-missing-model', {
      model: 'anthropic/missing',
      config: { apiKey: 'sk-ant' },
    });
    // The credential still lands (its provider comes from the model STRING, not the resolved
    // model), the SDK restores the session's saved model, and the stale ref surfaces as an error.
    expect(setKey).toHaveBeenCalledWith('anthropic', 'sk-ant');
    expect(sdkMock.createOpts).not.toHaveProperty('model');
    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({
      message: "pi: model 'anthropic/missing' is not available — using the session's saved model",
    });
  });

  it('targets the saved model provider for credential injection', async () => {
    seedSessionFile('res-3');
    sdkMock.entries = [
      {
        type: 'model_change',
        id: 'm1',
        parentId: null,
        timestamp: 't',
        provider: 'anthropic',
        modelId: 'claude-x',
      },
    ];
    const setKey = vi.fn();
    sdkMock.setRuntimeApiKey = setKey;

    await resume('res-3', { config: { apiKey: 'sk-123' } });
    expect(setKey).toHaveBeenCalledWith('anthropic', 'sk-123');
  });

  it('rejects when the session id resolves to no file', async () => {
    const adapter = new PiAdapter();
    adapter.onEvent(noop);
    await expect(
      adapter.resumeHistory({ historyId: asHistoryId('ghost') }, { kind: 'pi', cwd: '/x' }),
    ).rejects.toThrow("pi: history 'ghost' was not found");
  });

  it('surfaces the SDK model-restore fallback message as an error event', async () => {
    seedSessionFile('res-4');
    sdkMock.modelFallbackMessage = 'Could not restore model openai/gpt-old';
    const { events } = await resume('res-4');
    const error = events.findLast((e) => e.type === 'error');
    expect(error).toMatchObject({ message: 'pi: Could not restore model openai/gpt-old' });
  });
});

describe('pi fresh-session session-ref', () => {
  it('defers the announce until the first agent_start', async () => {
    const adapter = new PiAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start({ kind: 'pi', cwd: '/caller/cwd' });
    expect(sessionRefs(events)).toEqual([]);

    // Reach the fake session through the captured subscribe list: drive one agent_start.
    const prompt = adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    await prompt;
    // The fake session's prompt resolves without emitting; feed agent_start via the adapter's
    // internal handler by driving the subscription the adapter registered.
    interface FeedableSession {
      feed(ev: unknown): void;
    }
    const session = (adapter as unknown as { session: FeedableSession }).session;
    session.feed({ type: 'agent_start' });
    expect(sessionRefs(events)).toEqual(['fresh-session-id']);

    session.feed({ type: 'agent_start' });
    expect(sessionRefs(events)).toHaveLength(1);
  });
});
