import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, EffortLevel } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { asyncNoop, noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
  settings: {},
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
  resolveSettings: () => Promise.resolve({ effective: sdkMock.settings }),
}));

interface QueryInput {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Record<string, unknown>;
}

/** What the fake CLI feeds back to the adapter. The mocked module boundary erases the SDK's
 * message union, so the fake only needs runtime shape. */
type WireMessage = Record<string, unknown>;

/** Stands in for the SDK's `Query`: exposes the options it was created with, drains the streaming
 * prompt like the real read loop, and lets tests feed messages into the adapter's consume() loop. */
class FakeQuery {
  readonly options: Record<string, unknown>;
  /** Messages the SDK-side read loop has pulled off the streaming prompt so far. */
  readonly received: SDKUserMessage[] = [];
  readonly setModel = vi.fn<(model: string) => Promise<void>>(asyncNoop);
  readonly applyFlagSettings =
    vi.fn<(settings: Record<string, unknown>) => Promise<void>>(asyncNoop);
  readonly close = vi.fn(() => {
    this.push(null);
  });
  private readonly buffered: Array<WireMessage | null> = [];
  private waiting: ((msg: WireMessage | null) => void) | null = null;

  constructor(input: QueryInput) {
    this.options = input.options;
    void (async () => {
      for await (const msg of input.prompt) this.received.push(msg);
    })();
  }

  /** Feed one message to the adapter, as the CLI would. `null` ends the stream (close / crash). */
  push(msg: WireMessage | null): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(msg);
    } else {
      this.buffered.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<WireMessage> {
    while (true) {
      const next =
        this.buffered.length > 0
          ? this.buffered.shift()!
          : // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-message signal
            await new Promise<WireMessage | null>((resolve) => {
              this.waiting = resolve;
            });
      if (next === null) return;
      yield next;
    }
  }
}

const queries: FakeQuery[] = [];
let nextQuerySetup: ((q: FakeQuery) => void) | null = null;
let nextQueryError: Error | null = null;

sdkMock.query = (opts) => {
  if (nextQueryError) {
    const error = nextQueryError;
    nextQueryError = null;
    throw error;
  }
  const q = new FakeQuery(opts as QueryInput);
  queries.push(q);
  nextQuerySetup?.(q);
  nextQuerySetup = null;
  return q;
};

afterEach(() => {
  queries.length = 0;
  nextQuerySetup = null;
  sdkMock.settings = {};
  nextQueryError = null;
});

async function makeAdapter(effort?: EffortLevel): Promise<{
  adapter: ClaudeCodeAdapter;
  events: AgentEvent[];
}> {
  const adapter = new ClaudeCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'claude-code', cwd: '/tmp/repo', effort });
  return { adapter, events };
}

function prompt(adapter: ClaudeCodeAdapter): Promise<void> {
  return adapter.send({ type: 'prompt', content: [textBlock('hi')] });
}

function setEffort(adapter: ClaudeCodeAdapter, effort: 'low' | 'high' | 'max' | 'ultracode') {
  return adapter.send({ type: 'set-effort', effort });
}

async function waitIdle(events: AgentEvent[]): Promise<void> {
  await vi.waitFor(() => {
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });
}

describe('ClaudeCodeAdapter effort switching', () => {
  it('applies initial effort while constructing the first Query', async () => {
    const { events } = await makeAdapter('high');
    const q0 = queries[0];

    expect(q0.options.effort).toBeUndefined();
    expect(q0.applyFlagSettings).toHaveBeenCalledWith({ ultracode: null, effortLevel: 'high' });
    expect(events).toContainEqual({ type: 'effort-update', effort: 'high' });
  });

  it('passes initial max through the Query startup-only channel', async () => {
    const { events } = await makeAdapter('max');
    const q0 = queries[0];

    expect(q0.options.effort).toBe('max');
    expect(q0.applyFlagSettings).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'effort-update', effort: 'max' });
  });

  it('does not reflect an initial effort that the CLI rejects', async () => {
    nextQuerySetup = (q) => {
      q.applyFlagSettings.mockRejectedValue(new Error('dynamic workflows disabled'));
    };
    const { events } = await makeAdapter('ultracode');

    expect(events).not.toContainEqual({ type: 'effort-update', effort: 'ultracode' });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('dynamic workflows disabled'),
      }),
    );
  });

  it('applies a switchable level before the first message reaches the CLI', async () => {
    const { adapter } = await makeAdapter();
    const q0 = queries[0];

    let resolveFlags: (() => void) | undefined;
    q0.applyFlagSettings.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFlags = resolve;
        }),
    );
    const effortDone = setEffort(adapter, 'high');
    const promptDone = effortDone.then(() => prompt(adapter));
    await vi.waitFor(() => {
      expect(q0.applyFlagSettings).toHaveBeenCalledWith({
        ultracode: null,
        effortLevel: 'high',
      });
    });
    // The prompt must not enter the queue while the effort switch is still in flight.
    await wait(0);
    expect(q0.received).toHaveLength(0);

    resolveFlags?.();
    await promptDone;
    await vi.waitFor(() => {
      expect(q0.received).toHaveLength(1);
    });
  });

  it('treats re-picking the current level as a no-op instead of restarting', async () => {
    const { adapter } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];

    await setEffort(adapter, 'high');
    await setEffort(adapter, 'high');
    expect(q0.applyFlagSettings).toHaveBeenCalledTimes(1);
    expect(q0.close).not.toHaveBeenCalled();

    await setEffort(adapter, 'max');
    expect(q0.close).toHaveBeenCalledTimes(1);
    await prompt(adapter);
    const q1 = queries[1];
    expect(q1.options.effort).toBe('max');

    // Re-picking max must not kill the max process that was just rebuilt for it.
    await setEffort(adapter, 'max');
    expect(q1.close).not.toHaveBeenCalled();
  });

  it('does not commit a rejected live switch, so a rebuild never replays it', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];

    q0.applyFlagSettings.mockRejectedValueOnce(new Error('dynamic workflows disabled'));
    await expect(setEffort(adapter, 'ultracode')).rejects.toThrow('dynamic workflows disabled');

    // Process dies; the next prompt rebuilds the Query. The failed level must not resurface.
    q0.push(null);
    await waitIdle(events);
    await prompt(adapter);
    const q1 = queries[1];
    expect(q1.applyFlagSettings).not.toHaveBeenCalled();
    expect(q1.options.effort).toBeUndefined();
  });

  it('drops and reports a stored level the rebuild cannot apply, without failing the prompt', async () => {
    const { adapter, events } = await makeAdapter();
    const q0 = queries[0];
    q0.push(null);
    await waitIdle(events);
    await setEffort(adapter, 'ultracode');
    expect(events).not.toContainEqual({ type: 'effort-update', effort: 'ultracode' });

    nextQuerySetup = (q) => {
      q.applyFlagSettings.mockRejectedValue(new Error('dynamic workflows disabled'));
    };
    await prompt(adapter);
    expect(
      events.some((e) => e.type === 'error' && e.message.includes('dynamic workflows disabled')),
    ).toBe(true);
    // The turn itself still runs, at the CLI's default level.
    const q1 = queries[1];
    await vi.waitFor(() => {
      expect(q1.received).toHaveLength(1);
    });

    // The rejected level was dropped: the next rebuild applies nothing.
    q1.push(null);
    await waitIdle(events);
    await prompt(adapter);
    const q2 = queries[2];
    expect(q2.applyFlagSettings).not.toHaveBeenCalled();
    expect(q2.options.effort).toBeUndefined();
  });

  it('restarts across max transitions and resumes from the last session id', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];
    q0.push({ type: 'system', session_id: 'sess-1' });
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'session-ref')).toBe(true);
    });

    await setEffort(adapter, 'max');
    expect(q0.close).toHaveBeenCalledTimes(1);
    await prompt(adapter);
    const q1 = queries[1];
    expect(q1.options.effort).toBe('max');
    expect(q1.options.resume).toBe('sess-1');
    expect(q1.applyFlagSettings).not.toHaveBeenCalled();

    // Leaving max also needs a restart: the startup flag outranks flag-settings for its lifetime.
    await setEffort(adapter, 'high');
    expect(q1.close).toHaveBeenCalledTimes(1);
    await prompt(adapter);
    const q2 = queries[2];
    expect(q2.options.effort).toBeUndefined();
    expect(q2.options.resume).toBe('sess-1');
    expect(q2.applyFlagSettings).toHaveBeenCalledWith({ ultracode: null, effortLevel: 'high' });
  });

  it('does not let a detached Query unwind settle its replacement', async () => {
    const { adapter, events } = await makeAdapter();
    const q0 = queries[0];
    q0.close.mockImplementationOnce(noop);

    await setEffort(adapter, 'max');
    await prompt(adapter);
    expect(queries).toHaveLength(2);

    events.length = 0;
    q0.push(null);
    await wait(0);
    expect(events.some((event) => event.type === 'status' && event.status === 'idle')).toBe(false);
  });
});

/** The read-only Stop hook the adapter registers to learn the resolved effort level. */
function stopHookOf(q: FakeQuery): (input: unknown) => Promise<unknown> {
  const hooks = q.options.hooks as {
    Stop: Array<{ hooks: Array<(input: unknown) => Promise<unknown>> }>;
  };
  return hooks.Stop[0].hooks[0];
}

describe('ClaudeCodeAdapter model/effort reflection', () => {
  it('reflects the configured effort before the first turn, else the provider default', async () => {
    sdkMock.settings = { effortLevel: 'medium' };
    const configured = await makeAdapter();
    expect(configured.events).toContainEqual({ type: 'effort-update', effort: 'medium' });

    sdkMock.settings = {};
    const providerDefault = await makeAdapter();
    expect(providerDefault.events).toContainEqual({ type: 'effort-update', effort: 'high' });
  });

  it('reflects an explicit effort pick as an effort-update event', async () => {
    const { adapter, events } = await makeAdapter();
    await setEffort(adapter, 'high');
    expect(events).toContainEqual({ type: 'effort-update', effort: 'high' });
  });

  it('reflects an explicit model pick as a model-update event', async () => {
    const { adapter, events } = await makeAdapter();
    await adapter.send({ type: 'set-model', model: 'claude-opus-4-8' });
    expect(events).toContainEqual({ type: 'model-update', model: 'claude-opus-4-8' });
  });

  it('keeps an accepted live model across an effort-driven Query rebuild', async () => {
    const adapter = new ClaudeCodeAdapter();
    await adapter.start({
      kind: 'claude-code',
      cwd: '/tmp/repo',
      model: 'claude-sonnet-5',
    });
    await adapter.send({ type: 'set-model', model: 'claude-opus-4-8' });

    await setEffort(adapter, 'max');
    await prompt(adapter);
    expect(queries).toHaveLength(2);
    expect(queries[1].options.model).toBe('claude-opus-4-8');
    expect(queries[1].setModel).toHaveBeenCalledWith('claude-opus-4-8');
  });

  it('reflects a startup model only after the CLI accepts it', async () => {
    const adapter = new ClaudeCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    let acceptModel: (() => void) | undefined;
    nextQuerySetup = (q) => {
      q.setModel.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            acceptModel = resolve;
          }),
      );
    };

    const started = adapter.start({
      kind: 'claude-code',
      cwd: '/tmp/repo',
      model: 'claude-opus-4-8',
    });
    await vi.waitFor(() => {
      expect(queries[0].setModel).toHaveBeenCalledWith('claude-opus-4-8');
    });
    expect(events).not.toContainEqual({ type: 'model-update', model: 'claude-opus-4-8' });

    acceptModel?.();
    await started;
    expect(events).toContainEqual({ type: 'model-update', model: 'claude-opus-4-8' });
  });

  it('fails startup without reflecting a model the CLI rejects', async () => {
    nextQuerySetup = (q) => {
      q.setModel.mockRejectedValue(new Error('unknown model'));
    };
    const adapter = new ClaudeCodeAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await expect(
      adapter.start({
        kind: 'claude-code',
        cwd: '/tmp/repo',
        model: 'unavailable-model',
      }),
    ).rejects.toThrow('unknown model');
    expect(events).not.toContainEqual({ type: 'model-update', model: 'unavailable-model' });
    await adapter.stop();
  });

  it('reflects the served model the CLI reports on its init frame', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    queries[0].push({
      type: 'system',
      subtype: 'init',
      permissionMode: 'default',
      model: 'claude-sonnet-5',
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'model-update', model: 'claude-sonnet-5' });
    });
  });

  it('reconciles the displayed effort with what the Stop hook says actually ran', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const stopHook = stopHookOf(queries[0]);

    // The startup baseline is high; the hook reflects a model-specific downgrade.
    await stopHook({ effort: { level: 'medium' } });
    expect(events).toContainEqual({ type: 'effort-update', effort: 'medium' });

    // An explicit pick can also be silently downgraded by the model, so actual runtime wins.
    await setEffort(adapter, 'high');
    events.length = 0;
    await stopHook({ effort: { level: 'medium' } });
    expect(events).toContainEqual({ type: 'effort-update', effort: 'medium' });

    // Ultracode is an orchestration mode whose underlying hook level is xhigh; keep the mode.
    await setEffort(adapter, 'ultracode');
    events.length = 0;
    await stopHook({ effort: { level: 'xhigh' } });
    expect(events.some((event) => event.type === 'effort-update')).toBe(false);
  });

  it('ignores effort reported by a detached Query', async () => {
    const { adapter, events } = await makeAdapter();
    const staleStopHook = stopHookOf(queries[0]);

    await setEffort(adapter, 'max');
    await prompt(adapter);
    expect(queries).toHaveLength(2);

    events.length = 0;
    await staleStopHook({ effort: { level: 'medium' } });
    expect(events.some((event) => event.type === 'effort-update')).toBe(false);
  });

  it('preserves settings-derived Ultracode until the user selects another effort', async () => {
    sdkMock.settings = { effortLevel: 'xhigh', ultracode: true };
    const { adapter, events } = await makeAdapter();
    const stopHook = stopHookOf(queries[0]);

    expect(events).toContainEqual({ type: 'effort-update', effort: 'ultracode' });
    events.length = 0;
    await stopHook({ effort: { level: 'xhigh' } });
    expect(events.some((event) => event.type === 'effort-update')).toBe(false);

    await stopHook({ effort: { level: 'medium' } });
    expect(events).toContainEqual({ type: 'effort-update', effort: 'medium' });
    events.length = 0;
    await stopHook({ effort: { level: 'xhigh' } });
    expect(events).toContainEqual({ type: 'effort-update', effort: 'ultracode' });

    await setEffort(adapter, 'high');
    events.length = 0;
    await stopHook({ effort: { level: 'medium' } });
    expect(events).toContainEqual({ type: 'effort-update', effort: 'medium' });
  });
});

describe('ClaudeCodeAdapter auth failure', () => {
  it('surfaces a 401 result as an authentication_failed error, not a phantom stop', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    // The SDK reports a 401 as a `success` result carrying api_error_status (CODE-75 swallow point).
    queries[0].push({
      type: 'result',
      subtype: 'success',
      api_error_status: 401,
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: {},
    });
    await waitIdle(events);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'authentication_failed', recoverable: false }),
    );
    // The swallowed turn must not emit a usage or a phantom stop.
    expect(events.some((e) => e.type === 'stop')).toBe(false);
    expect(events.some((e) => e.type === 'token-usage')).toBe(false);
  });
});

describe('ClaudeCodeAdapter turn lifecycle', () => {
  it('unwinds running when recreating the Query rejects', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;
    queries[0].push(null);
    await waitIdle(events);
    events.length = 0;
    nextQueryError = new Error('spawn failed');

    await expect(prompt(adapter)).rejects.toThrow('spawn failed');

    expect(events).toEqual([
      { type: 'status', status: 'running' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('reports a Query EOF without a result as a failed turn and recovers on the next prompt', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;
    await prompt(adapter);
    queries[0].push({ type: 'system', session_id: 'sess-recover' });
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'session-ref')).toBe(true);
    });

    queries[0].push(null);
    await waitIdle(events);

    expect(events).toContainEqual({
      type: 'error',
      message: 'claude-code: query ended before the turn returned a result',
      recoverable: true,
    });
    expect(events.some((event) => event.type === 'stop')).toBe(false);

    events.length = 0;
    await prompt(adapter);
    expect(queries[1].options.resume).toBe('sess-recover');
    queries[1].push({
      type: 'result',
      subtype: 'success',
      stop_reason: 'end_turn',
      total_cost_usd: 0,
      usage: {},
    });
    await waitIdle(events);
    expect(events).toContainEqual({ type: 'stop', stopReason: 'end_turn' });
  });

  it('preserves structured diagnostics from a non-success result', async () => {
    const { adapter, events } = await makeAdapter();
    events.length = 0;
    await prompt(adapter);

    queries[0].push({
      type: 'result',
      subtype: 'error_during_execution',
      terminal_reason: 'turn_setup_failed',
      errors: ['MCP server failed', 'Connection refused'],
    });
    await waitIdle(events);

    expect(events).toContainEqual({
      type: 'error',
      message:
        'Claude failed (error_during_execution, turn_setup_failed): MCP server failed; Connection refused',
      recoverable: true,
    });
  });
});
