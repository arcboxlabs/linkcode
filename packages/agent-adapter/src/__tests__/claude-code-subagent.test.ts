import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import { ClaudeCodeAdapter } from '../native/claude-code';

/**
 * Subagent (Task tool) routing: every frame a subagent produces arrives with `parent_tool_use_id`
 * set to the spawning Task's tool_use id. The adapter must (a) stamp that id onto the emitted tool
 * calls / narration so the client can nest them, (b) render subagent text message-level from the
 * forwarded assistant frames while dropping their stream deltas (no double render), and (c) keep
 * the main agent's messageId cursor untouched so a subagent running mid-turn cannot break the main
 * streaming bubble.
 */

type AgentMessageChunk = Extract<AgentEvent, { type: 'agent-message-chunk' }>;
type AgentThoughtChunk = Extract<AgentEvent, { type: 'agent-thought-chunk' }>;

class TestClaude extends ClaudeCodeAdapter {
  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }
}

function harness() {
  const adapter = new TestClaude();
  const seen: AgentEvent[] = [];
  adapter.onEvent((e) => seen.push(e));
  return {
    feed: (value: object) => adapter.feed(value),
    chunks: () => seen.filter((e): e is AgentMessageChunk => e.type === 'agent-message-chunk'),
    thoughts: () => seen.filter((e): e is AgentThoughtChunk => e.type === 'agent-thought-chunk'),
    tools: () =>
      seen.reduce<ToolCall[]>((acc, e) => {
        if (e.type === 'tool-call') acc.push(e.toolCall);
        return acc;
      }, []),
  };
}

const TASK_ID = 'toolu_task1';

function taskAnnounce(): object {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    uuid: 'uuid-main-1',
    message: {
      content: [
        {
          type: 'tool_use',
          id: TASK_ID,
          name: 'Task',
          input: { description: 'map repo', prompt: 'map the repo', subagent_type: 'Explore' },
        },
      ],
    },
  };
}

describe('ClaudeCodeAdapter subagent routing', () => {
  it('classifies the Task announce as a task-kind tool call', () => {
    const h = harness();
    h.feed(taskAnnounce());
    const [task] = h.tools();
    expect(task.kind).toBe('task');
    expect(task.status).toBe('in_progress');
    expect(task.parentToolCallId).toBeUndefined();
  });

  it('classifies the renamed Agent spawn tool as task-kind too', () => {
    const h = harness();
    h.feed({
      type: 'assistant',
      parent_tool_use_id: null,
      uuid: 'uuid-main-2',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'x' } },
        ],
      },
    });
    expect(h.tools()[0].kind).toBe('task');
  });

  it('stamps parentToolCallId on subagent tool calls and their settles', () => {
    const h = harness();
    h.feed(taskAnnounce());
    h.feed({
      type: 'assistant',
      parent_tool_use_id: TASK_ID,
      uuid: 'uuid-sub-1',
      message: { content: [{ type: 'tool_use', id: 'toolu_sub1', name: 'Read', input: {} }] },
    });
    h.feed({
      type: 'user',
      parent_tool_use_id: TASK_ID,
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_sub1', content: 'ok' }] },
    });
    const sub = h.tools().filter((t) => t.toolCallId === 'toolu_sub1');
    expect(sub.map((t) => t.status)).toEqual(['in_progress', 'completed']);
    expect(sub.every((t) => t.parentToolCallId === TASK_ID)).toBe(true);
    expect(sub[0].kind).toBe('read');
  });

  it('renders subagent text message-level under the frame uuid, thinking under a distinct id', () => {
    const h = harness();
    h.feed({
      type: 'assistant',
      parent_tool_use_id: TASK_ID,
      uuid: 'uuid-sub-2',
      message: {
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'found it' },
        ],
      },
    });
    const [chunk] = h.chunks();
    expect(chunk.content).toEqual({ type: 'text', text: 'found it' });
    expect(chunk.messageId).toBe('uuid-sub-2');
    expect(chunk.parentToolCallId).toBe(TASK_ID);
    const [thought] = h.thoughts();
    expect(thought.messageId).toBe('uuid-sub-2:think');
    expect(thought.parentToolCallId).toBe(TASK_ID);
  });

  it('drops subagent stream deltas but keeps main-agent deltas flowing', () => {
    const h = harness();
    h.feed({
      type: 'stream_event',
      parent_tool_use_id: TASK_ID,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'sub' } },
    });
    expect(h.chunks()).toHaveLength(0);
    h.feed({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'main' } },
    });
    expect(h.chunks().map((c) => c.content)).toEqual([{ type: 'text', text: 'main' }]);
  });

  it('keeps the main messageId cursor across an interleaved subagent frame', () => {
    const h = harness();
    const mainDelta = (text: string) => ({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    });
    h.feed(mainDelta('before '));
    h.feed({
      type: 'assistant',
      parent_tool_use_id: TASK_ID,
      uuid: 'uuid-sub-3',
      message: { content: [{ type: 'text', text: 'subagent says' }] },
    });
    h.feed(mainDelta('after'));
    const main = h.chunks().filter((c) => c.parentToolCallId === undefined);
    expect(main).toHaveLength(2);
    expect(main[0].messageId).toBe(main[1].messageId);
  });

  it('settles the Task tool itself via its top-level tool_result', () => {
    const h = harness();
    h.feed(taskAnnounce());
    h.feed({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: TASK_ID, content: 'report' }] },
    });
    const task = h.tools().at(-1);
    expect(task?.toolCallId).toBe(TASK_ID);
    expect(task?.status).toBe('completed');
    expect(task?.kind).toBe('task');
  });

  it('keeps parentToolCallId when a subagent tool is auto-denied', () => {
    const h = harness();
    h.feed({
      type: 'assistant',
      parent_tool_use_id: TASK_ID,
      uuid: 'uuid-sub-4',
      message: { content: [{ type: 'tool_use', id: 'toolu_sub2', name: 'Bash', input: {} }] },
    });
    h.feed({
      type: 'system',
      subtype: 'permission_denied',
      tool_use_id: 'toolu_sub2',
      tool_name: 'Bash',
      decision_reason: 'blocked by policy',
    });
    const denied = h.tools().at(-1);
    expect(denied?.status).toBe('failed');
    expect(denied?.parentToolCallId).toBe(TASK_ID);
  });
});

describe('ClaudeCodeAdapter readHistory subagent splice', () => {
  const SESSION = 'session-1';

  function mainRow(type: 'user' | 'assistant', uuid: string, content: unknown[]): SessionMessage {
    return { type, uuid, session_id: SESSION, parent_tool_use_id: null, message: { content } };
  }

  function subRow(
    type: 'user' | 'assistant',
    uuid: string,
    content: string | unknown[],
  ): SessionMessage {
    return { type, uuid, session_id: SESSION, parent_tool_use_id: TASK_ID, message: { content } };
  }

  /** The trimmed slice of the SDK module surface readHistory touches. */
  function fakeSdk(overrides: {
    messages: SessionMessage[];
    subagents?: Record<string, SessionMessage[]>;
  }) {
    const subagents = overrides.subagents ?? {};
    return {
      getSessionInfo: () => Promise.resolve(undefined),
      getSessionMessages: () => Promise.resolve(overrides.messages),
      listSubagents: () => Promise.resolve(Object.keys(subagents)),
      getSubagentMessages: (_sessionId: string, agentId: string) =>
        Promise.resolve(subagents[agentId] ?? []),
    };
  }

  class HistoryClaude extends ClaudeCodeAdapter {
    constructor(private readonly sdk: ReturnType<typeof fakeSdk>) {
      super();
    }

    protected override loadSdk<T>(): Promise<T> {
      return Promise.resolve(this.sdk as T);
    }
  }

  const mainMessages = [
    mainRow('user', 'u0', [{ type: 'text', text: 'go' }]),
    mainRow('assistant', 'u1', [
      { type: 'tool_use', id: TASK_ID, name: 'Agent', input: { description: 'explore' } },
    ]),
    mainRow('user', 'u2', [{ type: 'tool_result', tool_use_id: TASK_ID, content: 'report' }]),
    mainRow('assistant', 'u3', [{ type: 'text', text: 'summary' }]),
  ];

  it('splices the subagent transcript right after the spawn announce, parent-linked', async () => {
    const adapter = new HistoryClaude(
      fakeSdk({
        messages: mainMessages,
        subagents: {
          agent1: [
            subRow('user', 's0', 'injected prompt'),
            subRow('assistant', 's1', [{ type: 'text', text: 'nested narration' }]),
            subRow('assistant', 's2', [
              { type: 'tool_use', id: 'toolu_sub', name: 'Bash', input: {} },
            ]),
            subRow('user', 's3', [
              { type: 'tool_result', tool_use_id: 'toolu_sub', content: 'ok' },
            ]),
          ],
        },
      }),
    );
    const result = await adapter.readHistory({ historyId: asHistoryId(SESSION) });

    const kinds = result.events.map((e) =>
      e.event.type === 'tool-call'
        ? `${e.event.type}:${e.event.toolCall.toolCallId}:${e.event.toolCall.status}`
        : `${e.event.type}:${e.itemId ?? ''}`,
    );
    expect(kinds).toEqual([
      'user-message:u0',
      `tool-call:${TASK_ID}:in_progress`,
      // Spliced subagent transcript (injected prompt skipped, rest parent-linked):
      'agent-message-chunk:s1',
      'tool-call:toolu_sub:in_progress',
      'tool-call:toolu_sub:completed',
      // Main transcript resumes:
      `tool-call:${TASK_ID}:completed`,
      'agent-message-chunk:u3',
    ]);

    for (const e of result.events) {
      if (e.event.type === 'tool-call' && e.event.toolCall.toolCallId === 'toolu_sub') {
        expect(e.event.toolCall.parentToolCallId).toBe(TASK_ID);
      }
      if (e.event.type === 'agent-message-chunk' && e.itemId === 's1') {
        expect(e.event.parentToolCallId).toBe(TASK_ID);
      }
    }
  });

  it('leaves sessions without subagents untouched', async () => {
    const adapter = new HistoryClaude(fakeSdk({ messages: mainMessages }));
    const result = await adapter.readHistory({ historyId: asHistoryId(SESSION) });
    expect(result.events.map((e) => e.event.type)).toEqual([
      'user-message',
      'tool-call',
      'tool-call',
      'agent-message-chunk',
    ]);
  });
});
