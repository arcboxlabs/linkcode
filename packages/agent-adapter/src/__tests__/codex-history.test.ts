import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import { mapCodexHistoryEvents } from '../native/codex/history';

const HID = asHistoryId('019f0000-codex-test');

// Row shapes below mirror real rollout lines (codex-cli 0.140.0, ~/.codex/sessions).
function responseItem(payload: Record<string, unknown>, timestamp?: string) {
  return { type: 'response_item', payload, timestamp };
}

describe('mapCodexHistoryEvents', () => {
  it('replays text and drops synthetic user rows (pre-existing behavior)', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem(
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        '2026-07-01T00:00:00Z',
      ),
      responseItem({
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: '<environment_context>injected</environment_context>' },
        ],
      }),
      responseItem({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hi there' }],
      }),
    ]);
    expect(events.map((event) => event.event.type)).toEqual([
      'user-message',
      'agent-message-chunk',
    ]);
    expect(events[0].ts).toBe(Date.parse('2026-07-01T00:00:00Z'));
  });

  it('replays a function_call/function_call_output pair correlated by call_id', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd": "cat greet.py", "workdir": "/tmp/diff-test"}',
        call_id: 'call_exec1',
      }),
      responseItem({
        type: 'function_call_output',
        call_id: 'call_exec1',
        output: 'def greet():\n    print("hello")\n',
      }),
    ]);
    const tools = events.flatMap((event) =>
      event.event.type === 'tool-call' ? [event.event.toolCall] : [],
    );
    expect(tools).toHaveLength(2);
    // Same id for announce and settle → buildConversation replaces by id, no duplicate card.
    expect(tools[0]).toMatchObject({
      toolCallId: 'call_exec1',
      title: 'exec_command',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { cmd: 'cat greet.py', workdir: '/tmp/diff-test' },
    });
    expect(tools[1]).toMatchObject({
      toolCallId: 'call_exec1',
      title: 'exec_command',
      kind: 'execute',
      status: 'completed',
    });
    expect(tools[1].content).toEqual([
      {
        type: 'content',
        content: { type: 'text', text: 'def greet():\n    print("hello")\n' },
      },
    ]);
  });

  it('replays a custom_tool_call apply_patch pair as an edit tool with the raw envelope input', () => {
    const patch = '*** Begin Patch\n*** Update File: greet.py\n@@\n-a\n+b\n*** End Patch\n';
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'custom_tool_call',
        status: 'completed',
        call_id: 'call_patch1',
        name: 'apply_patch',
        input: patch,
      }),
      responseItem({
        type: 'custom_tool_call_output',
        call_id: 'call_patch1',
        output: 'Exit code: 0\nOutput:\nSuccess. Updated the following files:\nM greet.py\n',
      }),
    ]);
    const tools = events.flatMap((event) =>
      event.event.type === 'tool-call' ? [event.event.toolCall] : [],
    );
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      toolCallId: 'call_patch1',
      title: 'apply_patch',
      kind: 'edit',
      status: 'in_progress',
      rawInput: patch,
    });
    expect(tools[1]).toMatchObject({
      toolCallId: 'call_patch1',
      kind: 'edit',
      status: 'completed',
    });
  });

  it('settles an output whose announce sits beyond the page window with first-sight defaults', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({ type: 'function_call_output', call_id: 'call_orphan', output: 'late' }),
    ]);
    const tools = events.flatMap((event) =>
      event.event.type === 'tool-call' ? [event.event.toolCall] : [],
    );
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      toolCallId: 'call_orphan',
      title: 'call_orphan',
      kind: 'other',
      status: 'completed',
    });
  });

  it('keeps non-JSON function arguments as the raw string', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments: 'not-json',
        call_id: 'call_raw',
      }),
    ]);
    const tools = events.flatMap((event) =>
      event.event.type === 'tool-call' ? [event.event.toolCall] : [],
    );
    expect(tools[0].rawInput).toBe('not-json');
  });

  it('interleaves tools with text in rollout order', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'run it' }],
      }),
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments: '{}',
        call_id: 'call_1',
      }),
      responseItem({ type: 'function_call_output', call_id: 'call_1', output: 'ok' }),
      responseItem({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'done' }],
      }),
    ]);
    expect(events.map((event) => event.event.type)).toEqual([
      'user-message',
      'tool-call',
      'tool-call',
      'agent-message-chunk',
    ]);
  });
});
