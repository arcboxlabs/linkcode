import type { SDKControlGetUsageResponse, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, UsageReport } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { asyncNoop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter, mapClaudeUsageReport } from '../native/claude-code';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
}));

interface QueryInput {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Record<string, unknown>;
}

/** What the fake CLI feeds back to the adapter. The mocked module boundary erases the SDK's
 * message union, so the fake only needs runtime shape. */
type WireMessage = Record<string, unknown>;

/** Default `supportedCommands()` result — no catalog, until a test overrides it. */
function emptyCommandCatalog(): Promise<unknown[]> {
  return Promise.resolve([]);
}

/** A full SDK get-usage response, shaped per the pinned SDK 0.3.206 `.d.ts`. */
const SDK_USAGE_RESPONSE: SDKControlGetUsageResponse = {
  session: {
    total_cost_usd: 1.23,
    total_api_duration_ms: 4000,
    total_duration_ms: 60_000,
    total_lines_added: 10,
    total_lines_removed: 2,
    model_usage: {
      'claude-opus-4-8': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 25,
        cacheCreationInputTokens: 5,
        webSearchRequests: 0,
        costUSD: 1.23,
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
      },
    },
  },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 6, resets_at: '2026-07-16T07:49:00Z' },
    seven_day: { utilization: 74, resets_at: '2026-07-18T17:00:00Z' },
    seven_day_opus: null,
    model_scoped: [{ display_name: 'Fable', utilization: 100, resets_at: '2026-07-18T16:59:00Z' }],
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  },
  behaviors: {
    day: {
      request_count: 1167,
      session_count: 9,
      behaviors: [{ key: 'long_context', pct: 78, count: 910 }],
      agents: [{ name: 'workflow-subagent', pct: 9 }],
      skills: [{ name: 'artifact-design', pct: 2 }],
      plugins: [],
      mcp_servers: [{ name: 'claude.ai Linear', pct: 35 }],
    },
    week: {
      request_count: 7590,
      session_count: 39,
      behaviors: [],
      agents: [],
      skills: [],
      plugins: [],
      mcp_servers: [],
    },
  },
};

/** `SDK_USAGE_RESPONSE` on the Link Code `UsageReport` contract. */
const EXPECTED_USAGE_REPORT: UsageReport = {
  session: {
    totalCostUsd: 1.23,
    totalApiDurationMs: 4000,
    totalDurationMs: 60_000,
    totalLinesAdded: 10,
    totalLinesRemoved: 2,
    modelUsage: {
      'claude-opus-4-8': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheCreationTokens: 5,
        totalCostUsd: 1.23,
      },
    },
  },
  subscriptionType: 'max',
  rateLimits: {
    fiveHour: { utilization: 6, resetsAt: '2026-07-16T07:49:00Z' },
    sevenDay: { utilization: 74, resetsAt: '2026-07-18T17:00:00Z' },
    sevenDayOpus: null,
    modelScoped: [{ displayName: 'Fable', utilization: 100, resetsAt: '2026-07-18T16:59:00Z' }],
    extraUsage: { isEnabled: false, monthlyLimit: null, usedCredits: null, utilization: null },
  },
  behaviors: {
    day: {
      requestCount: 1167,
      sessionCount: 9,
      behaviors: [{ key: 'long_context', pct: 78, count: 910 }],
      agents: [{ name: 'workflow-subagent', pct: 9 }],
      skills: [{ name: 'artifact-design', pct: 2 }],
      plugins: [],
      mcpServers: [{ name: 'claude.ai Linear', pct: 35 }],
    },
    week: {
      requestCount: 7590,
      sessionCount: 39,
      behaviors: [],
      agents: [],
      skills: [],
      plugins: [],
      mcpServers: [],
    },
  },
};

/** Stands in for the SDK's `Query`: exposes the options it was created with, drains the streaming
 * prompt like the real read loop, and lets tests feed messages into the adapter's consume() loop. */
class FakeQuery {
  readonly options: Record<string, unknown>;
  /** Messages the SDK-side read loop has pulled off the streaming prompt so far. */
  readonly received: SDKUserMessage[] = [];
  readonly applyFlagSettings =
    vi.fn<(settings: Record<string, unknown>) => Promise<void>>(asyncNoop);
  readonly supportedCommands = vi.fn<() => Promise<unknown[]>>(emptyCommandCatalog);
  readonly usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = vi.fn<
    () => Promise<SDKControlGetUsageResponse>
  >(() => Promise.resolve(SDK_USAGE_RESPONSE));
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

sdkMock.query = (opts) => {
  const q = new FakeQuery(opts as QueryInput);
  queries.push(q);
  nextQuerySetup?.(q);
  nextQuerySetup = null;
  return q;
};

afterEach(() => {
  queries.length = 0;
  nextQuerySetup = null;
});

async function makeAdapter(
  setup?: (q: FakeQuery) => void,
): Promise<{ adapter: ClaudeCodeAdapter; events: AgentEvent[] }> {
  const adapter = new ClaudeCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  nextQuerySetup = setup ?? null;
  await adapter.start({ kind: 'claude-code', cwd: '/tmp/repo' });
  return { adapter, events };
}

function prompt(adapter: ClaudeCodeAdapter): Promise<void> {
  return adapter.send({ type: 'prompt', content: [textBlock('hi')] });
}

function agentChunks(
  events: AgentEvent[],
): Array<Extract<AgentEvent, { type: 'agent-message-chunk' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'agent-message-chunk' }> =>
      e.type === 'agent-message-chunk',
  );
}

function commandUpdates(
  events: AgentEvent[],
): Array<Extract<AgentEvent, { type: 'available-commands-update' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'available-commands-update' }> =>
      e.type === 'available-commands-update',
  );
}

describe('ClaudeCodeAdapter slash commands', () => {
  it('does not block adapter start while command discovery is pending', async () => {
    let resolveCatalog: ((commands: unknown[]) => void) | undefined;
    const started = makeAdapter((q) => {
      q.supportedCommands.mockReturnValue(
        new Promise((resolve) => {
          resolveCatalog = resolve;
        }),
      );
    });

    const { events } = await started;
    expect(commandUpdates(events)).toHaveLength(0);
    resolveCatalog?.([{ name: 'review', description: 'Review code' }]);
    await vi.waitFor(() => expect(commandUpdates(events)).toHaveLength(1));
  });

  it('publishes the catalog at adapter start, before the first prompt', async () => {
    const { events } = await makeAdapter((q) => {
      q.supportedCommands.mockResolvedValue([
        { name: 'review', description: 'Review the diff', argumentHint: '<path>' },
        // Empty-string description/argumentHint are dropped; aliases ride through so the
        // composer/engine name matching accepts them. An empty aliases list is dropped too.
        { name: 'usage', description: '', argumentHint: '', aliases: ['cost'] },
        { name: 'clear', description: 'Reset', argumentHint: '', aliases: [] },
      ]);
    });

    await vi.waitFor(() => {
      expect(commandUpdates(events)).toHaveLength(1);
    });
    expect(commandUpdates(events)[0].commands).toEqual([
      {
        name: 'review',
        description: 'Review the diff',
        argumentHint: '<path>',
        aliases: undefined,
      },
      { name: 'usage', description: undefined, argumentHint: undefined, aliases: ['cost'] },
      { name: 'clear', description: 'Reset', argumentHint: undefined, aliases: undefined },
    ]);
  });

  it('does not surface an error when supportedCommands() rejects', async () => {
    const { events } = await makeAdapter((q) => {
      q.supportedCommands.mockRejectedValue(new Error('not ready'));
    });
    // Let the rejected publishCommands() microtask settle.
    await vi.waitFor(() => {
      expect(queries[0].supportedCommands).toHaveBeenCalled();
    });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(commandUpdates(events)).toHaveLength(0);
  });

  it('replaces the catalog wholesale on a commands_changed push', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];
    // The default supportedCommands() mock already resolved an empty catalog at Query creation.
    await vi.waitFor(() => {
      expect(commandUpdates(events)).toHaveLength(1);
    });

    q0.push({
      type: 'system',
      subtype: 'commands_changed',
      commands: [{ name: 'voice', description: 'Voice mode', argumentHint: '' }],
      uuid: 'u1',
      session_id: 's1',
    });

    await vi.waitFor(() => {
      expect(commandUpdates(events)).toHaveLength(2);
    });
    expect(commandUpdates(events).at(-1)?.commands).toEqual([
      { name: 'voice', description: 'Voice mode', argumentHint: undefined },
    ]);
  });

  it('emits local_command_output as an assistant-style chunk in its own segment', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];

    q0.push({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'before' } },
    });
    await vi.waitFor(() => {
      expect(agentChunks(events)).toHaveLength(1);
    });
    const before = agentChunks(events)[0];

    q0.push({
      type: 'system',
      subtype: 'local_command_output',
      content: 'Usage: 42% used',
      uuid: 'u2',
      session_id: 's1',
    });
    await vi.waitFor(() => {
      expect(agentChunks(events)).toHaveLength(2);
    });
    const output = agentChunks(events)[1];
    expect(output.content).toEqual(textBlock('Usage: 42% used'));
    expect(output.messageId).not.toBe(before.messageId);

    q0.push({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'after' } },
    });
    await vi.waitFor(() => {
      expect(agentChunks(events)).toHaveLength(3);
    });
    const after = agentChunks(events)[2];
    expect(after.messageId).not.toBe(output.messageId);
  });
});

describe('ClaudeCodeAdapter command invocation', () => {
  it('pushes the command as a plain slash-prefixed user message and emits status running', async () => {
    const { adapter, events } = await makeAdapter();
    const sendDone = adapter.send({ type: 'command', name: 'review', arguments: 'src' });

    expect(events).toContainEqual({ type: 'status', status: 'running' });
    await sendDone;

    await vi.waitFor(() => {
      expect(queries).toHaveLength(1);
      expect(queries[0].received).toHaveLength(1);
    });
    expect(queries[0].received[0]).toEqual({
      type: 'user',
      message: { role: 'user', content: '/review src' },
      parent_tool_use_id: null,
    });
  });

  it('omits the trailing space when no arguments are given', async () => {
    const { adapter } = await makeAdapter();
    await adapter.send({ type: 'command', name: 'compact' });

    await vi.waitFor(() => {
      expect(queries[0].received).toHaveLength(1);
    });
    expect(queries[0].received[0].message).toEqual({ role: 'user', content: '/compact' });
  });
});

/** Let the FakeQuery's prompt-drain loop tick, so "nothing was pushed" assertions are real. */
function flushDrainLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function usageReports(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'usage-report' }>> {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'usage-report' }> => e.type === 'usage-report',
  );
}

function statuses(events: AgentEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'status' ? [e.status] : []));
}

describe('ClaudeCodeAdapter /usage interception', () => {
  it('serves /usage as a structured usage-report — no prompt, no transcript text, a running→idle bracket', async () => {
    const { adapter, events } = await makeAdapter();
    const before = events.length;
    await adapter.send({ type: 'command', name: 'usage' });
    const after = events.slice(before);

    const reports = usageReports(after);
    expect(reports).toHaveLength(1);
    expect(reports[0].report).toEqual(EXPECTED_USAGE_REPORT);

    await flushDrainLoop();
    expect(queries[0].received).toHaveLength(0);
    // The turn-contract bracket: the busy window is announced, and (no result frame will follow)
    // the matching idle is emitted by reportUsage itself before send() resolves.
    expect(statuses(after)).toEqual(['running', 'idle']);
    expect(agentChunks(after)).toHaveLength(0);
    expect(after.some((e) => e.type === 'error')).toBe(false);
  });

  it('intercepts the provider alias (/cost) via the advertised catalog', async () => {
    const { adapter, events } = await makeAdapter((q) => {
      q.supportedCommands.mockResolvedValue([{ name: 'usage', aliases: ['cost'] }]);
    });
    await vi.waitFor(() => {
      expect(commandUpdates(events)).toHaveLength(1);
    });

    await adapter.send({ type: 'command', name: 'cost' });

    expect(usageReports(events)).toHaveLength(1);
    await flushDrainLoop();
    expect(queries[0].received).toHaveLength(0);
  });

  it('emits a recoverable error when the control request fails — no text fallback, bracket still closes', async () => {
    const { adapter, events } = await makeAdapter((q) => {
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET.mockRejectedValue(
        new Error('control transport closed'),
      );
    });
    const before = events.length;
    await adapter.send({ type: 'command', name: 'usage' });
    const after = events.slice(before);

    const errors = after.filter(
      (e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error',
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].recoverable).toBe(true);
    expect(errors[0].message).toContain('control transport closed');
    expect(usageReports(after)).toHaveLength(0);
    // The failure path must still settle the busy window it opened.
    expect(statuses(after)).toEqual(['running', 'idle']);
    await flushDrainLoop();
    expect(queries[0].received).toHaveLength(0);
    expect(agentChunks(after)).toHaveLength(0);
  });

  it('emits an error when the SDK pair lacks the get-usage control request (feature-detect)', async () => {
    const { adapter, events } = await makeAdapter((q) => {
      // Simulate a drifted SDK where the experimental method was renamed/removed.
      Reflect.deleteProperty(q, 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET');
    });
    await adapter.send({ type: 'command', name: 'usage' });

    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(usageReports(events)).toHaveLength(0);
    await flushDrainLoop();
    expect(queries[0].received).toHaveLength(0);
  });
});

describe('mapClaudeUsageReport', () => {
  it('maps the SDK response onto the UsageReport contract (snake→camel, model_usage→TokenUsage)', () => {
    expect(mapClaudeUsageReport(SDK_USAGE_RESPONSE)).toEqual(EXPECTED_USAGE_REPORT);
  });

  it('passes null sections through untouched (API-key / non-subscriber sessions)', () => {
    const report = mapClaudeUsageReport({
      session: {
        total_cost_usd: 0,
        total_api_duration_ms: 0,
        total_duration_ms: 0,
        total_lines_added: 0,
        total_lines_removed: 0,
        model_usage: {},
      },
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null,
      behaviors: null,
    });
    expect(report.subscriptionType).toBeNull();
    expect(report.rateLimits).toBeNull();
    expect(report.behaviors).toBeNull();
    expect(report.session?.modelUsage).toEqual({});
  });

  it('rejects a drifted reply instead of shipping malformed data (trust-boundary parse)', () => {
    const drifted: SDKControlGetUsageResponse = {
      ...SDK_USAGE_RESPONSE,
      // @ts-expect-error -- deliberately drifted: a CLI pair that reports a non-numeric cost
      session: { ...SDK_USAGE_RESPONSE.session, total_cost_usd: 'not-a-number' },
    };
    expect(() => mapClaudeUsageReport(drifted)).toThrow();
  });
});
