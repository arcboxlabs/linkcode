import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { asyncNoop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';

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

/** Stands in for the SDK's `Query`: exposes the options it was created with, drains the streaming
 * prompt like the real read loop, and lets tests feed messages into the adapter's consume() loop. */
class FakeQuery {
  readonly options: Record<string, unknown>;
  /** Messages the SDK-side read loop has pulled off the streaming prompt so far. */
  readonly received: SDKUserMessage[] = [];
  readonly applyFlagSettings =
    vi.fn<(settings: Record<string, unknown>) => Promise<void>>(asyncNoop);
  readonly supportedCommands = vi.fn<() => Promise<unknown[]>>(emptyCommandCatalog);
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

async function makeAdapter(): Promise<{ adapter: ClaudeCodeAdapter; events: AgentEvent[] }> {
  const adapter = new ClaudeCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
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
  it('publishes the catalog fetched from supportedCommands() at Query creation', async () => {
    const { adapter, events } = await makeAdapter();
    nextQuerySetup = (q) => {
      q.supportedCommands.mockResolvedValue([
        { name: 'review', description: 'Review the diff', argumentHint: '<path>' },
        // Empty-string description/argumentHint and an alias — both dropped by the mapper.
        { name: 'usage', description: '', argumentHint: '', aliases: ['cost'] },
      ]);
    };
    await prompt(adapter);

    await vi.waitFor(() => {
      expect(commandUpdates(events)).toHaveLength(1);
    });
    expect(commandUpdates(events)[0].commands).toEqual([
      { name: 'review', description: 'Review the diff', argumentHint: '<path>' },
      { name: 'usage', description: undefined, argumentHint: undefined },
    ]);
  });

  it('does not surface an error when supportedCommands() rejects', async () => {
    const { adapter, events } = await makeAdapter();
    nextQuerySetup = (q) => {
      q.supportedCommands.mockRejectedValue(new Error('not ready'));
    };
    await prompt(adapter);
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
