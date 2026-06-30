import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';
import { PiAdapter } from '../native/pi';

/**
 * Regression guard for the messageId grouping contract: `agent-message-chunk` events are bucketed by
 * `messageId` downstream (buildConversation), so an adapter MUST open a fresh id for narration emitted
 * after a tool call. Reusing one id for the whole turn merges pre- and post-tool text into a single
 * bubble and reorders the post-tool narration ahead of the tool — these tests fail under that bug.
 *
 * The streaming handlers only run inside the SDK loop (onStart/onPrompt), so test subclasses expose them.
 */

type AgentMessageChunk = Extract<AgentEvent, { type: 'agent-message-chunk' }>;

function agentChunks(events: AgentEvent[]): AgentMessageChunk[] {
  return events.filter((e): e is AgentMessageChunk => e.type === 'agent-message-chunk');
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

function claudeTextDelta(text: string): object {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text } },
  };
}

describe('PiAdapter message grouping', () => {
  it('opens a fresh messageId for narration after a tool call', () => {
    const adapter = new TestPi();
    const seen = record(adapter);

    adapter.feed({ type: 'agent_start' });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'before' },
    });
    adapter.feed({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: {} });
    adapter.feed({ type: 'tool_execution_end', toolCallId: 't1', isError: false, result: 'ok' });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'after' },
    });

    const chunks = agentChunks(seen);
    expect(chunks.map((c) => c.content)).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'after' },
    ]);
    expect(chunks[0].messageId).not.toBe(chunks[1].messageId);
  });

  it('keeps consecutive narration (no tool between) under one messageId', () => {
    const adapter = new TestPi();
    const seen = record(adapter);

    adapter.feed({ type: 'agent_start' });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'a' },
    });
    adapter.feed({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'b' },
    });

    const chunks = agentChunks(seen);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].messageId).toBe(chunks[1].messageId);
  });
});

describe('ClaudeCodeAdapter message grouping', () => {
  it('opens a fresh messageId for narration after a tool_use', () => {
    const adapter = new TestClaude();
    const seen = record(adapter);

    adapter.feed(claudeTextDelta('before'));
    adapter.feed({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
    });
    adapter.feed({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    });
    adapter.feed(claudeTextDelta('after'));

    const chunks = agentChunks(seen);
    expect(chunks.map((c) => c.content)).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'after' },
    ]);
    expect(chunks[0].messageId).not.toBe(chunks[1].messageId);
  });
});
