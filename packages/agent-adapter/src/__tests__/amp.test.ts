import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import type { ExecuteOptions, StreamMessage, Usage } from '@sourcegraph/amp-sdk';
import { describe, expect, it, vi } from 'vitest';
import { asHistoryId } from '../history-util';
import { AmpAdapter } from '../native/amp/adapter';
import { mapAmpHistoryEvents } from '../native/amp/history';
import { AmpProbe } from '../probe/amp';

const SID = 'T-0000-test-thread';

type Script = (request: ExecuteOptions) => AsyncIterable<StreamMessage>;

class TestAmpAdapter extends AmpAdapter {
  readonly requests: ExecuteOptions[] = [];
  private readonly scripts: Script[] = [];

  script(next: Script): void {
    this.scripts.push(next);
  }

  protected override startExecute(request: ExecuteOptions): Promise<AsyncIterable<StreamMessage>> {
    this.requests.push(request);
    const next = this.scripts.shift();
    if (!next) throw new Error('amp test: no script queued for startExecute');
    return Promise.resolve(next(request));
  }
}

function startOptions(): StartOptions {
  return { kind: 'amp', cwd: '/tmp/amp-test' };
}

// eslint-disable-next-line @typescript-eslint/require-await -- the adapter consumes an AsyncIterable; a sync generator wouldn't fit the seam's type
async function* streamOf(...messages: StreamMessage[]): AsyncGenerator<StreamMessage> {
  for (const message of messages) yield message;
}

function init(): StreamMessage {
  return {
    type: 'system',
    subtype: 'init',
    cwd: '/tmp/amp-test',
    session_id: SID,
    tools: ['Bash', 'Read', 'edit_file'],
    mcp_servers: [],
  };
}

function userEcho(text: string): StreamMessage {
  return {
    type: 'user',
    session_id: SID,
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text }] },
  };
}

function assistantText(id: string, text: string, usage?: Usage): StreamMessage {
  return {
    type: 'assistant',
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage,
    },
  };
}

function assistantToolUse(id: string, toolId: string, usage?: Usage): StreamMessage {
  return {
    type: 'assistant',
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: toolId, name: 'Bash', input: { cmd: 'ls' } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage,
    },
  };
}

function toolResult(toolId: string, output: string, isError = false): StreamMessage {
  return {
    type: 'user',
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, content: output, is_error: isError }],
    },
  };
}

function success(): StreamMessage {
  return {
    type: 'result',
    subtype: 'success',
    session_id: SID,
    is_error: false,
    result: 'done',
    duration_ms: 5,
    num_turns: 1,
  };
}

function errorResult(subtype: 'error_during_execution' | 'error_max_turns'): StreamMessage {
  return {
    type: 'result',
    subtype,
    session_id: SID,
    is_error: true,
    error: 'boom',
    duration_ms: 5,
    num_turns: 1,
  };
}

function usage(input: number, output: number): Usage {
  return { input_tokens: input, output_tokens: output };
}

type AssistantStreamMessage = Extract<StreamMessage, { type: 'assistant' }>;

/** The CLI's actual serializer sends `{type:"message",role:"assistant",content,stop_reason,
 * usage}` with NO id/model/stop_sequence, despite the SDK types declaring them. */
function idlessAssistantText(text: string): StreamMessage {
  const typed = assistantText('ignored', text) as AssistantStreamMessage;
  const { id: _id, model: _model, stop_sequence: _stop, ...message } = typed.message;
  const raw: Omit<AssistantStreamMessage, 'message'> & { message: typeof message } = {
    ...typed,
    message,
  };
  return raw as StreamMessage;
}

async function startedAdapter(): Promise<{ adapter: TestAmpAdapter; events: AgentEvent[] }> {
  const adapter = new TestAmpAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((event) => events.push(event));
  await adapter.start(startOptions());
  return { adapter, events };
}

function ofType<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T,
): Array<Extract<AgentEvent, { type: T }>> {
  return events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
}

describe('AmpAdapter turn mapping', () => {
  it('maps a full turn: text, tool pairing, cumulative usage, stop, held session-ref', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script(() =>
      streamOf(
        init(),
        userEcho('list files'),
        assistantToolUse('msg_1', 'toolu_1', usage(10, 5)),
        toolResult('toolu_1', 'file-a\nfile-b'),
        assistantText('msg_2', 'Two files.', usage(20, 7)),
        success(),
      ),
    );
    await adapter.send({ type: 'prompt', content: [textBlock('list files')] });

    // The CLI echoes the prompt back as a user message; the engine already broadcast it.
    expect(ofType(events, 'user-message')).toHaveLength(0);

    const chunks = ofType(events, 'agent-message-chunk');
    expect(chunks.map((chunk) => [chunk.messageId, chunk.content])).toEqual([
      ['msg_1', textBlock('Let me check.')],
      ['msg_2', textBlock('Two files.')],
    ]);

    const toolEvents = ofType(events, 'tool-call');
    const tools = toolEvents.map((event) => event.toolCall);
    expect(tools[0]).toMatchObject({
      toolCallId: 'toolu_1',
      title: 'Bash',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { cmd: 'ls' },
    });
    expect(tools[1]).toMatchObject({
      toolCallId: 'toolu_1',
      status: 'completed',
      content: [{ type: 'content', content: textBlock('file-a\nfile-b') }],
    });

    const usages = ofType(events, 'token-usage');
    expect(usages.at(-1)?.usage).toEqual({
      inputTokens: 30,
      outputTokens: 12,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    // Fresh thread: the ref is held until the result confirms the turn persisted server-side.
    const refs = ofType(events, 'session-ref');
    expect(refs).toHaveLength(1);
    expect(refs[0].historyId).toBe(SID);
    expect(events.indexOf(refs[0])).toBeGreaterThan(events.indexOf(toolEvents[1]));

    expect(ofType(events, 'stop').map((event) => event.stopReason)).toEqual(['end_turn']);
    expect(ofType(events, 'status').at(-1)?.status).toBe('idle');
  });

  it('announces the session-ref immediately when resuming, and continues the thread', async () => {
    const adapter = new TestAmpAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.resumeHistory({ historyId: asHistoryId(SID) }, startOptions());

    adapter.script(() => streamOf(init(), assistantText('msg_1', 'welcome back'), success()));
    await adapter.send({ type: 'prompt', content: [textBlock('continue')] });

    expect(adapter.requests[0]?.options?.continue).toBe(SID);
    const refs = ofType(events, 'session-ref');
    expect(refs).toHaveLength(1);
    // Emitted on the first live message (the init), not deferred to the result.
    const chunkIndex = events.findIndex((event) => event.type === 'agent-message-chunk');
    expect(events.indexOf(refs[0])).toBeLessThan(chunkIndex);
  });

  it('queues a prompt during a running turn and continues the captured thread', async () => {
    const { adapter, events } = await startedAdapter();
    let releaseTurn!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    adapter.script(() =>
      (async function* () {
        yield init();
        await gate;
        yield success();
      })(),
    );
    adapter.script(() => streamOf(init(), assistantText('msg_2', 'second answer'), success()));

    const first = adapter.send({ type: 'prompt', content: [textBlock('first')] });
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(1));
    // Queued: no second startExecute until the first turn ends.
    await adapter.send({ type: 'prompt', content: [textBlock('second')] });
    expect(adapter.requests).toHaveLength(1);

    releaseTurn();
    await first;
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(2));
    expect(adapter.requests[1]?.prompt).toBe('second');
    expect(adapter.requests[1]?.options?.continue).toBe(SID);
    await vi.waitFor(() => expect(ofType(events, 'stop')).toHaveLength(2));
  });

  it('cancel aborts the turn, sweeps the in-flight tool, and stops as cancelled', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script((request) =>
      (async function* () {
        yield init();
        yield assistantToolUse('msg_1', 'toolu_1');
        await new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(new Error('Amp CLI process was aborted'));
          });
        });
      })(),
    );
    const turn = adapter.send({ type: 'prompt', content: [textBlock('long task')] });
    await vi.waitFor(() => expect(ofType(events, 'tool-call')).toHaveLength(1));

    await adapter.send({ type: 'cancel' });
    await turn;

    expect(ofType(events, 'error')).toHaveLength(0);
    expect(ofType(events, 'stop').map((event) => event.stopReason)).toEqual(['cancelled']);
    const swept = ofType(events, 'tool-call').at(-1)?.toolCall;
    expect(swept).toMatchObject({ toolCallId: 'toolu_1', status: 'failed' });
    expect(ofType(events, 'status').at(-1)?.status).toBe('idle');
  });

  it('renders a file-tool result carrying {diff, lineRange} as structured diff content', async () => {
    const { adapter, events } = await startedAdapter();
    // Real edit_file result payload observed live.
    const payload = JSON.stringify({
      diff: 'diff\n--- /private/tmp/diff-test/greet.py\toriginal\n+++ /private/tmp/diff-test/greet.py\tmodified\n@@ -1,2 +1,2 @@\n def greet():\n- print("goodbye")\n+ print("hello")\n',
      lineRange: [2, 2],
    });
    adapter.script(() =>
      streamOf(
        init(),
        assistantToolUse('msg_1', 'toolu_1'),
        toolResult('toolu_1', payload),
        success(),
      ),
    );
    await adapter.send({ type: 'prompt', content: [textBlock('edit it')] });

    const settled = ofType(events, 'tool-call').at(-1)?.toolCall;
    expect(settled?.status).toBe('completed');
    expect(settled?.content).toEqual([
      {
        type: 'diff',
        path: '/private/tmp/diff-test/greet.py',
        oldText: 'def greet():\n print("goodbye")',
        newText: 'def greet():\n print("hello")',
      },
    ]);
    // The raw payload survives for consumers that want it.
    expect(settled?.rawOutput).toBe(payload);
  });

  it('mints per-message ids when the CLI omits message.id (real wire shape)', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script(() =>
      streamOf(init(), idlessAssistantText('first'), idlessAssistantText('second'), success()),
    );
    await adapter.send({ type: 'prompt', content: [textBlock('go')] });

    const chunks = ofType(events, 'agent-message-chunk');
    expect(chunks.map((chunk) => chunk.content)).toEqual([textBlock('first'), textBlock('second')]);
    for (const chunk of chunks) {
      expect(typeof chunk.messageId).toBe('string');
      expect(chunk.messageId.length).toBeGreaterThan(0);
    }
    // Distinct messages must not merge into one bubble.
    expect(chunks[0].messageId).not.toBe(chunks[1].messageId);
  });

  it('does not emit a second stop when a cancel races the post-result exit await', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script((request) =>
      (async function* () {
        yield init();
        yield success();
        // The SDK yields the result, then awaits process exit — an abort in that window
        // rejects the stream after the turn already settled.
        await new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => {
            reject(new Error('Operation was aborted'));
          });
        });
      })(),
    );
    const turn = adapter.send({ type: 'prompt', content: [textBlock('quick')] });
    await vi.waitFor(() => expect(ofType(events, 'stop')).toHaveLength(1));
    await adapter.send({ type: 'cancel' });
    await turn;
    expect(ofType(events, 'stop').map((event) => event.stopReason)).toEqual(['end_turn']);
    expect(ofType(events, 'error')).toHaveLength(0);
  });

  it('binds the session-ref after a first turn that never reached its result', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script((request) =>
      (async function* () {
        yield init(); // thread exists server-side from here on
        await new Promise<never>((_resolve, reject) => {
          const fail = (): void => reject(new Error('Amp CLI process was aborted'));
          // The abort can land before this generator body runs (like the real SDK, which
          // also checks the signal synchronously before waiting).
          if (request.signal?.aborted) fail();
          else request.signal?.addEventListener('abort', fail);
        });
      })(),
    );
    const turn = adapter.send({ type: 'prompt', content: [textBlock('doomed')] });
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(1));
    await adapter.send({ type: 'cancel' });
    await turn;
    expect(ofType(events, 'session-ref').map((event) => event.historyId)).toEqual([SID]);
  });

  it('surfaces an execution error without a stop, and maps max-turns to its stop reason', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script(() => streamOf(init(), errorResult('error_during_execution')));
    await adapter.send({ type: 'prompt', content: [textBlock('fail')] });
    expect(ofType(events, 'error').map((event) => event.message)).toEqual(['boom']);
    expect(ofType(events, 'stop')).toHaveLength(0);

    adapter.script(() => streamOf(init(), errorResult('error_max_turns')));
    await adapter.send({ type: 'prompt', content: [textBlock('again')] });
    expect(ofType(events, 'stop').map((event) => event.stopReason)).toEqual(['max_turn_requests']);
  });

  it('rejects set-model and set-effort — legacy has no mode/effort channel', async () => {
    const { adapter } = await startedAdapter();
    await expect(adapter.send({ type: 'set-model', model: 'deep' })).rejects.toThrow(
      'amp: model can only be set when starting a session',
    );
    await expect(adapter.send({ type: 'set-effort', effort: 'xhigh' })).rejects.toThrow(
      'amp: changing effort is not supported',
    );

    adapter.script(() => streamOf(init(), success()));
    await adapter.send({ type: 'prompt', content: [textBlock('go')] });
    const opts = adapter.requests[0]?.options;
    expect(opts).not.toHaveProperty('mode');
    expect(opts).not.toHaveProperty('effort');
    expect(opts).not.toHaveProperty('noArchiveAfterExecute');
    expect(opts).not.toHaveProperty('thinking');
  });

  it('reports a failed spawn as a recoverable error and returns to idle', async () => {
    const { adapter, events } = await startedAdapter();
    adapter.script(() => {
      throw new Error('spawn failed');
    });
    await adapter.send({ type: 'prompt', content: [textBlock('go')] });
    expect(ofType(events, 'error').map((event) => event.message)).toEqual(['Error: spawn failed']);
    expect(ofType(events, 'status').at(-1)?.status).toBe('idle');
  });
});

describe('amp history mapping', () => {
  it('replays typed text and drops tool_result-only user rows', () => {
    const events = mapAmpHistoryEvents(asHistoryId(SID), [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        protocolMessageID: 'm1',
        created: '2026-07-01T00:00:00Z',
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi there' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
        ],
        protocolMessageID: 'm2',
      },
      // A tool_result-only user row is plumbing, not something the user typed.
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'out', is_error: false }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'out', is_error: false },
          { type: 'text', text: 'typed too' },
        ],
      },
      { role: 'system', content: [{ type: 'text', text: 'not conversation' }] },
    ]);
    expect(events.map((event) => [event.event.type, event.itemId])).toEqual([
      ['user-message', 'm1'],
      ['agent-message-chunk', 'm2'],
      ['user-message', 'user-3'],
    ]);
    expect(events[0].ts).toBe(Date.parse('2026-07-01T00:00:00Z'));
  });
});

describe('AmpProbe', () => {
  it('accepts real CLI output and rejects impostors', () => {
    const probe = new AmpProbe();
    expect(
      probe.parseVersion('0.0.1783401425-gc7fcc1 (released 2026-07-07T05:17:05.000Z, 1d ago)\n'),
    ).toBe('0.0.1783401425-gc7fcc1');
    expect(probe.parseVersion('0.0.1783401425-gc7fcc1')).toBeUndefined();
    expect(probe.parseVersion('amp-imposter 1.0.0')).toBeUndefined();
  });

  it('honors the location test seam', () => {
    expect(new AmpProbe(['/nonexistent/amp']).knownLocations()).toEqual(['/nonexistent/amp']);
  });
});
