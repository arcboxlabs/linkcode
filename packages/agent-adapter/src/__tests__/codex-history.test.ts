import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import { mapCodexHistoryEvents } from '../native/codex/history';
import { applyPatchToolView } from '../native/codex/history-tools';

const HID = asHistoryId('019f0000-codex-test');

// Row shapes below mirror real rollout lines (codex-cli 0.140.0, ~/.codex/sessions).
function responseItem(payload: Record<string, unknown>, timestamp?: string) {
  return { type: 'response_item', payload, timestamp };
}

function toolCalls(events: ReturnType<typeof mapCodexHistoryEvents>) {
  return events.flatMap((event) =>
    event.event.type === 'tool-call' ? [event.event.toolCall] : [],
  );
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

  it('drops the 0.144 injection row: AGENTS.md prose part glued to <environment_context> (CODE-235)', () => {
    const events = mapCodexHistoryEvents(HID, [
      // codex 0.144 dropped the <user_instructions> wrapper: one user row, two content parts.
      responseItem({
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '# AGENTS.md instructions for C:\\Users\\flynn\\Desktop\\yose-chat\n\n<INSTRUCTIONS>\nimmer + combine 是标准组合\n</INSTRUCTIONS>',
          },
          {
            type: 'input_text',
            text: '<environment_context>\n  <cwd>C:\\Users\\flynn\\Desktop\\yose-chat</cwd>\n  <shell>powershell</shell>\n</environment_context>',
          },
        ],
      }),
      // A mid-session AGENTS.md change re-injects with a replacement preamble, no env part.
      responseItem({
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'These AGENTS.md instructions replace all previously provided AGENTS.md instructions.\n\n# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>',
          },
        ],
      }),
      responseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '介绍一下这个项目' }],
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({ type: 'user-message' });
  });

  it('keeps a real prompt that begins with a marker when its event_msg echo pairs it', () => {
    const pasted = '# AGENTS.md instructions for /repo — why does codex inject this?';
    const events = mapCodexHistoryEvents(HID, [
      // Real prompts are echoed as event_msg/user_message; injected rows never are.
      { type: 'event_msg', payload: { type: 'user_message', message: pasted } },
      responseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: pasted }],
      }),
      responseItem({
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>',
          },
          {
            type: 'input_text',
            text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>',
          },
        ],
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({ type: 'user-message' });
    if (events[0].event.type === 'user-message') {
      expect(events[0].event.content).toEqual([{ type: 'text', text: pasted }]);
    }
  });

  it('replays exec_command like the live commandExecution item: command title, unwrapped output', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments:
          '{"cmd": "cat greet.py", "workdir": "/tmp/diff-test", "max_output_tokens": 2000}',
        call_id: 'call_exec1',
      }),
      responseItem({
        type: 'function_call_output',
        call_id: 'call_exec1',
        output:
          'Chunk ID: a2bed9\nWall time: 0.0000 seconds\nProcess exited with code 0\nOriginal token count: 8\nOutput:\ndef greet():\n    print("hello")\n',
      }),
    ]);
    const tools = toolCalls(events);
    expect(tools).toHaveLength(2);
    // Same id for announce and settle → buildConversation replaces by id, no duplicate card.
    expect(tools[0]).toMatchObject({
      toolCallId: 'call_exec1',
      title: 'cat greet.py',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'cat greet.py', cwd: '/tmp/diff-test' },
    });
    expect(tools[1]).toMatchObject({
      toolCallId: 'call_exec1',
      title: 'cat greet.py',
      kind: 'execute',
      status: 'completed',
      rawOutput: 0,
    });
    expect(tools[1].content).toEqual([
      {
        type: 'content',
        content: { type: 'text', text: 'def greet():\n    print("hello")\n' },
      },
    ]);
  });

  it('settles an aborted run and a declined run as failed with the raw text as the record', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd": "sleep 120"}',
        call_id: 'call_abort',
      }),
      responseItem({
        type: 'function_call_output',
        call_id: 'call_abort',
        output: 'aborted by user after 89.0s',
      }),
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd": "touch /etc/hosts"}',
        call_id: 'call_decline',
      }),
      responseItem({
        type: 'function_call_output',
        call_id: 'call_decline',
        output: 'exec_command failed for `touch /etc/hosts`: rejected by user',
      }),
    ]);
    const settled = toolCalls(events).filter((tool) => tool.status !== 'in_progress');
    expect(settled.map((tool) => tool.status)).toEqual(['failed', 'failed']);
    expect(settled[0].content).toEqual([
      { type: 'content', content: { type: 'text', text: 'aborted by user after 89.0s' } },
    ]);
  });

  it('replays apply_patch like the live fileChange item: diff blocks kept through settle', () => {
    const patch =
      '*** Begin Patch\n*** Update File: greet.py\n@@\n-    print("hello")\n+    print("goodbye")\n*** End Patch\n';
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
        output:
          'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nM greet.py\n',
      }),
    ]);
    const tools = toolCalls(events);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      toolCallId: 'call_patch1',
      title: 'Apply file changes',
      kind: 'edit',
      status: 'in_progress',
      locations: [{ path: 'greet.py' }],
      rawInput: patch,
    });
    const diff = {
      type: 'diff',
      path: 'greet.py',
      oldText: '    print("hello")',
      newText: '    print("goodbye")',
    };
    expect(tools[0].content).toEqual([diff]);
    // Settle keeps the announce's diff blocks — the receipt text is not the record.
    expect(tools[1]).toMatchObject({ status: 'completed', kind: 'edit' });
    expect(tools[1].content).toEqual([diff]);
  });

  it('appends the receipt text when an apply_patch settles with a nonzero exit code', () => {
    const patch = '*** Begin Patch\n*** Update File: a.txt\n@@\n-x\n+y\n*** End Patch\n';
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'custom_tool_call',
        call_id: 'call_patchfail',
        name: 'apply_patch',
        input: patch,
      }),
      responseItem({
        type: 'custom_tool_call_output',
        call_id: 'call_patchfail',
        output: 'Exit code: 1\nWall time: 0.1 seconds\nOutput:\npatch does not apply\n',
      }),
    ]);
    const settled = toolCalls(events)[1];
    expect(settled.status).toBe('failed');
    expect(settled.content).toEqual([
      { type: 'diff', path: 'a.txt', oldText: 'x', newText: 'y' },
      { type: 'content', content: { type: 'text', text: 'patch does not apply\n' } },
    ]);
  });

  it('replays update_plan as a plan event and swallows its receipt output', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'update_plan',
        arguments:
          '{"plan":[{"step":"read the code","status":"completed"},{"step":"fix it","status":"in_progress"}]}',
        call_id: 'call_plan1',
      }),
      responseItem({
        type: 'function_call_output',
        call_id: 'call_plan1',
        output: 'Plan updated',
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({
      type: 'plan',
      plan: {
        entries: [
          { content: 'read the code', priority: 'medium', status: 'completed' },
          { content: 'fix it', priority: 'medium', status: 'in_progress' },
        ],
      },
    });
  });

  it('replays the pre-0.140 local_shell_call pair as an execute step titled by its argv', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'local_shell_call',
        call_id: 'call_shell1',
        status: 'completed',
        action: { type: 'exec', command: ['bash', '-lc', 'ls'], timeout_ms: 1000 },
      }),
      responseItem({ type: 'local_shell_call_output', call_id: 'call_shell1', output: 'file.txt' }),
    ]);
    const tools = toolCalls(events);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      title: 'bash -lc ls',
      kind: 'execute',
      status: 'in_progress',
    });
    expect(tools[1]).toMatchObject({ title: 'bash -lc ls', status: 'completed' });
    expect(tools[1].content).toEqual([
      { type: 'content', content: { type: 'text', text: 'file.txt' } },
    ]);
  });

  it('does not misread envelope output whose body mentions the declined-run phrase', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd": "grep failed deploy.log"}',
        call_id: 'call_grep',
      }),
      responseItem({
        type: 'function_call_output',
        call_id: 'call_grep',
        output:
          'Chunk ID: abc123\nWall time: 0.1 seconds\nProcess exited with code 0\nOriginal token count: 9\nOutput:\ndeploy failed for `service-a`: timeout\n',
      }),
    ]);
    // The declined marker is anchored to the very start of the output; a normal run's envelope
    // starts with `Chunk ID:`, so a body line matching the phrase must not flip it to failed.
    const settled = toolCalls(events)[1];
    expect(settled.status).toBe('completed');
    expect(settled.content).toEqual([
      {
        type: 'content',
        content: { type: 'text', text: 'deploy failed for `service-a`: timeout\n' },
      },
    ]);
  });

  it('maps write_stdin to an execute step, not the edit the name heuristic would guess', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'function_call',
        name: 'write_stdin',
        arguments: '{"session_id":1,"chars":"q"}',
        call_id: 'call_stdin',
      }),
    ]);
    expect(toolCalls(events)[0]).toMatchObject({ title: 'write_stdin', kind: 'execute' });
  });

  it('settles an output whose announce sits beyond the page window with first-sight defaults', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({ type: 'function_call_output', call_id: 'call_orphan', output: 'late' }),
    ]);
    const tools = toolCalls(events);
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
    expect(toolCalls(events)[0].rawInput).toBe('not-json');
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

describe('applyPatchToolView', () => {
  it('parses add, update-with-move, and delete sections into diffs and locations', () => {
    const view = applyPatchToolView(
      [
        '*** Begin Patch',
        '*** Add File: new.txt',
        '+line one',
        '+line two',
        '*** Update File: old-name.txt',
        '*** Move to: new-name.txt',
        '@@ def main():',
        ' context',
        '-before',
        '+after',
        '*** Delete File: gone.txt',
        '*** End Patch',
      ].join('\n'),
    );
    expect(view).not.toBeNull();
    expect(view?.locations).toEqual([
      { path: 'new.txt' },
      { path: 'new-name.txt' },
      { path: 'gone.txt' },
    ]);
    expect(view?.content).toEqual([
      { type: 'diff', path: 'new.txt', newText: 'line one\nline two' },
      {
        type: 'diff',
        path: 'new-name.txt',
        oldText: 'context\nbefore',
        newText: 'context\nafter',
      },
      { type: 'content', content: { type: 'text', text: 'Deleted gone.txt' } },
    ]);
  });

  it('splits multiple hunks of one file into one diff block per hunk', () => {
    const view = applyPatchToolView(
      '*** Begin Patch\n*** Update File: a.py\n@@\n-one\n+ONE\n@@\n-two\n+TWO\n*** End Patch\n',
    );
    expect(view?.content).toEqual([
      { type: 'diff', path: 'a.py', oldText: 'one', newText: 'ONE' },
      { type: 'diff', path: 'a.py', oldText: 'two', newText: 'TWO' },
    ]);
  });

  it('returns null for input that is not a Begin Patch envelope', () => {
    expect(applyPatchToolView('not a patch')).toBeNull();
    expect(applyPatchToolView('*** Begin Patch\n*** End Patch\n')).toBeNull();
  });
});
