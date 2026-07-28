import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';
import { PiAdapter } from '../native/pi';

/**
 * Regression guard for the messageId grouping contract: `agent-message-chunk` events are bucketed
 * by `messageId` downstream (buildConversation), so an adapter MUST open a fresh id for narration
 * emitted after a tool call — reusing one id merges pre- and post-tool text into a single bubble
 * and reorders the post-tool narration ahead of the tool. The streaming handlers only run inside
 * the SDK loop, so test subclasses expose them.
 */

type AgentMessage = Extract<AgentEvent, { type: 'agent-message' }>;
type AgentMessageChunk = Extract<AgentEvent, { type: 'agent-message-chunk' }>;
type AgentThoughtChunk = Extract<AgentEvent, { type: 'agent-thought-chunk' }>;

function agentMessages(events: AgentEvent[]): AgentMessage[] {
  return events.filter((e): e is AgentMessage => e.type === 'agent-message');
}

function agentChunks(events: AgentEvent[]): AgentMessageChunk[] {
  return events.filter((e): e is AgentMessageChunk => e.type === 'agent-message-chunk');
}

function agentThoughts(events: AgentEvent[]): AgentThoughtChunk[] {
  return events.filter((e): e is AgentThoughtChunk => e.type === 'agent-thought-chunk');
}

/** Capture every emitted event from an adapter into a flat list. */
function record(adapter: { onEvent(cb: (e: AgentEvent) => void): unknown }): AgentEvent[] {
  const seen: AgentEvent[] = [];
  adapter.onEvent((e) => seen.push(e));
  return seen;
}

class TestPi extends PiAdapter {
  feed(value: object): void {
    this.handleEvent(value as AgentSessionEvent);
  }
}

class TestClaude extends ClaudeCodeAdapter {
  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }
}

function claudeMessageStart(messageId: string): object {
  return {
    type: 'stream_event',
    uuid: 'start-frame',
    session_id: 's1',
    parent_tool_use_id: null,
    event: { type: 'message_start', message: { id: messageId } },
  };
}

function claudeTextDelta(text: string): object {
  return {
    type: 'stream_event',
    uuid: `delta-frame-${text}`,
    session_id: 's1',
    parent_tool_use_id: null,
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  };
}

/** Drives an adapter's narration/tool events through equivalent scenarios so the shared
 * fresh-segment-after-a-tool-call contract (`BaseAgentAdapter#freshSegment`) is exercised once
 * against every adapter. */
interface AdapterDriver {
  seen: AgentEvent[];
  text(delta: string): void;
  toolCall(): void;
}

function piDriver(): AdapterDriver {
  const adapter = new TestPi();
  const seen = record(adapter);
  adapter.feed({ type: 'agent_start' });
  return {
    seen,
    text: (delta) =>
      adapter.feed({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta },
      }),
    toolCall() {
      adapter.feed({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: {} });
      adapter.feed({ type: 'tool_execution_end', toolCallId: 't1', isError: false, result: 'ok' });
    },
  };
}

function claudeDriver(): AdapterDriver {
  const adapter = new TestClaude();
  const seen = record(adapter);
  adapter.feed(claudeMessageStart('claude-before-tool'));
  return {
    seen,
    text: (delta) => adapter.feed(claudeTextDelta(delta)),
    toolCall() {
      adapter.feed({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
      });
      adapter.feed({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      });
      adapter.feed(claudeMessageStart('claude-after-tool'));
    },
  };
}

describe.each([
  { name: 'PiAdapter', make: piDriver },
  { name: 'ClaudeCodeAdapter', make: claudeDriver },
])('$name message grouping', ({ make }) => {
  it('opens a fresh messageId for narration after a tool call', () => {
    const driver = make();
    driver.text('before');
    driver.toolCall();
    driver.text('after');

    const chunks = agentChunks(driver.seen);
    expect(chunks.map((c) => c.content)).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'after' },
    ]);
    expect(chunks[0].messageId).not.toBe(chunks[1].messageId);
  });
});

describe('PiAdapter message grouping', () => {
  it('keeps consecutive narration (no tool between) under one messageId', () => {
    const adapter = new TestPi();
    const seen = record(adapter);

    adapter.feed({ type: 'agent_start' });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'a',
        partial: { responseId: 'pi-response-1', timestamp: 42 },
      },
    });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: 'b',
        partial: { responseId: 'pi-response-1', timestamp: 42 },
      },
    });

    const chunks = agentChunks(seen);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].messageId).toBe(chunks[1].messageId);
    expect(chunks[0].messageId).toBe('pi-response-1:message:0');
  });

  it('uses one provider block id for live deltas and the completed whole message', () => {
    const adapter = new TestPi();
    const seen = record(adapter);
    const partial = { responseId: 'pi-response-1', timestamp: 42 };

    adapter.feed({ type: 'agent_start' });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 1,
        delta: 'draft',
        partial,
      },
    });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: {
        type: 'text_end',
        contentIndex: 1,
        content: 'final',
        partial,
      },
    });

    expect(agentChunks(seen)[0].messageId).toBe('pi-response-1:message:1');
    expect(agentMessages(seen)).toEqual([
      {
        type: 'agent-message',
        messageId: 'pi-response-1:message:1',
        parentToolCallId: undefined,
        content: [{ type: 'text', text: 'final' }],
      },
    ]);
  });
});

describe('ClaudeCodeAdapter message identity', () => {
  it('uses the provider message id across SDK frames and history', () => {
    const adapter = new TestClaude();
    const seen = record(adapter);

    adapter.feed(claudeMessageStart('provider-message'));
    adapter.feed(claudeTextDelta('a'));
    adapter.feed(claudeTextDelta('b'));
    adapter.feed({
      type: 'stream_event',
      uuid: 'thought-delta-frame',
      session_id: 's1',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: 'hmm' },
      },
    });

    expect(agentChunks(seen).map((chunk) => chunk.messageId)).toEqual([
      'provider-message',
      'provider-message',
    ]);
    expect(agentThoughts(seen).map((event) => event.messageId)).toEqual(['provider-message:think']);
  });
});
