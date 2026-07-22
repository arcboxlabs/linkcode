import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES } from '@linkcode/schema';
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

function base64WithByteLength(bytes: number): string {
  const groups = Math.floor(bytes / 3);
  const remainder = bytes % 3;
  return `${'AAAA'.repeat(groups)}${remainder === 1 ? 'AA==' : remainder === 2 ? 'AAA=' : ''}`;
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
    expect(events.map((event) => event.event.type)).toEqual(['user-message', 'agent-message']);
    expect(events[0].ts).toBe(Date.parse('2026-07-01T00:00:00Z'));
  });

  it('replays persisted user images in their text order', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'message',
        id: 'user-with-image',
        role: 'user',
        content: [
          { type: 'input_text', text: 'before' },
          { type: 'input_image', image_url: 'data:image/png;base64,cG5n' },
          { type: 'input_text', text: 'after' },
        ],
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({
      type: 'user-message',
      messageId: 'user-with-image',
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
        { type: 'text', text: 'after' },
      ],
    });
  });

  it('hides persisted local-image path markers while retaining their embedded image', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'message',
        id: 'local-image',
        role: 'user',
        content: [
          { type: 'input_text', text: 'before' },
          { type: 'input_text', text: '<image name=[Image #1] path="/private/screenshot.png">' },
          { type: 'input_image', image_url: 'data:image/webp;base64,d2VicA==' },
          { type: 'input_text', text: '</image>' },
          { type: 'input_text', text: 'after' },
        ],
      }),
    ]);

    expect(events[0].event).toMatchObject({
      type: 'user-message',
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', data: 'd2VicA==', mimeType: 'image/webp' },
        { type: 'text', text: 'after' },
      ],
    });
  });

  it('rescues a marker-prefixed image prompt through its concatenated event echo', () => {
    const before = '# AGENTS.md instructions shown in my screenshot';
    const after = 'after';
    const events = mapCodexHistoryEvents(HID, [
      { type: 'event_msg', payload: { type: 'user_message', message: `${before}${after}` } },
      responseItem({
        type: 'message',
        id: 'marker-image',
        role: 'user',
        content: [
          { type: 'input_text', text: before },
          { type: 'input_image', image_url: 'data:image/png;base64,cG5n' },
          { type: 'input_text', text: after },
        ],
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({
      type: 'user-message',
      content: [
        { type: 'text', text: before },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
        { type: 'text', text: after },
      ],
    });
  });

  it('does not rescue an injected text-only row through a concatenated prompt echo', () => {
    const injectedInstructions =
      '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>x</INSTRUCTIONS>';
    const injectedEnvironment = '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>';
    const concatenated = `${injectedInstructions}${injectedEnvironment}`;
    const events = mapCodexHistoryEvents(HID, [
      { type: 'event_msg', payload: { type: 'user_message', message: concatenated } },
      responseItem({
        type: 'message',
        id: 'injected-context',
        role: 'user',
        content: [
          { type: 'input_text', text: injectedInstructions },
          { type: 'input_text', text: injectedEnvironment },
        ],
      }),
      responseItem({
        type: 'message',
        id: 'real-prompt',
        role: 'user',
        content: [{ type: 'input_text', text: concatenated }],
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({
      type: 'user-message',
      messageId: 'real-prompt',
      content: [{ type: 'text', text: concatenated }],
    });
  });

  it('drops individually oversized and aggregate-overflow images but keeps safe text', () => {
    const individuallyOversized = base64WithByteLength(MAX_ATTACHMENT_BYTES + 1);
    const first = base64WithByteLength(MAX_ATTACHMENT_TOTAL_BYTES / 2 + 3);
    const second = base64WithByteLength(MAX_ATTACHMENT_TOTAL_BYTES / 2);
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'message',
        id: 'oversized-images',
        role: 'user',
        content: [
          { type: 'input_text', text: 'safe text' },
          { type: 'input_image', image_url: `data:image/png;base64,${individuallyOversized}` },
          { type: 'input_image', image_url: `data:image/png;base64,${first}` },
          { type: 'input_image', image_url: `data:image/png;base64,${second}` },
        ],
      }),
    ]);

    expect(events[0].event).toMatchObject({
      type: 'user-message',
      content: [
        { type: 'text', text: 'safe text' },
        { type: 'image', data: first, mimeType: 'image/png' },
      ],
    });
  });

  it.each([
    ['a local path', '/private/screenshot.png'],
    ['a file URL', 'file:///private/screenshot.png'],
    ['a remote URL', 'https://example.com/screenshot.png'],
    ['an executable data URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['an unsupported image data URL', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['malformed base64', 'data:image/png;base64,not base64'],
  ])('does not expose %s as a replayable image', (_label, imageUrl) => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'message',
        id: 'unsafe-image',
        role: 'user',
        content: [
          { type: 'input_text', text: 'safe text' },
          { type: 'input_image', image_url: imageUrl },
        ],
      }),
    ]);

    expect(events[0].event).toMatchObject({
      type: 'user-message',
      content: [{ type: 'text', text: 'safe text' }],
    });
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

  it('still drops a glued row when an unmarked twin of one part was echoed as a real prompt', () => {
    // The echoed prompt text coincides with the glued row's env part; the AGENTS.md part was
    // never echoed, so the injected row must stay filtered while the real prompt replays.
    const envText = '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>';
    const events = mapCodexHistoryEvents(HID, [
      { type: 'event_msg', payload: { type: 'user_message', message: envText } },
      responseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: envText }],
      }),
      responseItem({
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nx\n</INSTRUCTIONS>',
          },
          { type: 'input_text', text: envText },
        ],
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({ type: 'user-message' });
    if (events[0].event.type === 'user-message') {
      expect(events[0].event.content).toEqual([{ type: 'text', text: envText }]);
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
      change: 'modify',
      path: 'greet.py',
      oldText: '    print("hello")',
      newText: '    print("goodbye")',
    };
    expect(tools[0].content).toEqual([diff]);
    // Settle keeps the announce's diff blocks — the receipt text is not the record.
    expect(tools[1]).toMatchObject({ status: 'completed', kind: 'edit' });
    expect(tools[1].content).toEqual([diff]);
  });

  it('replays add, delete, and move sections without inventing missing text', () => {
    const view = applyPatchToolView(
      [
        '*** Begin Patch',
        '*** Add File: added.ts',
        '+export {};',
        '*** Delete File: removed.bin',
        '*** Update File: old.ts',
        '*** Move to: new.ts',
        '*** End Patch',
      ].join('\n'),
    );

    expect(view).toEqual({
      content: [
        { type: 'diff', change: 'add', path: 'added.ts', newText: 'export {};' },
        { type: 'diff', change: 'delete', path: 'removed.bin' },
        {
          type: 'diff',
          change: 'move',
          path: 'new.ts',
          oldPath: 'old.ts',
          oldText: undefined,
          newText: undefined,
        },
      ],
      locations: [{ path: 'added.ts' }, { path: 'removed.bin' }, { path: 'new.ts' }],
    });
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
      {
        type: 'diff',
        change: 'modify',
        path: 'a.txt',
        oldPath: undefined,
        oldText: 'x',
        newText: 'y',
      },
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
      'agent-message',
    ]);
  });

  it('replays a compacted row as a compaction marker carrying the summary (CODE-142)', () => {
    const events = mapCodexHistoryEvents(HID, [
      responseItem({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'long conversation' }],
      }),
      {
        type: 'compacted',
        payload: { message: 'summary of earlier turns', window_id: 'w-2' },
        timestamp: '2026-07-02T00:00:00Z',
      },
      responseItem({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'continuing' }],
      }),
    ]);
    expect(events.map((event) => event.event.type)).toEqual([
      'user-message',
      'compaction',
      'agent-message',
    ]);
    expect(events[1]).toMatchObject({
      itemId: 'w-2',
      ts: Date.parse('2026-07-02T00:00:00Z'),
      event: { type: 'compaction', compactionId: 'w-2', summary: 'summary of earlier turns' },
    });
  });

  it('falls back to a positional compaction id when the compacted row has no window_id', () => {
    const events = mapCodexHistoryEvents(HID, [
      { type: 'compacted', payload: { message: 'old summary' } },
    ]);
    expect(events[0].event).toMatchObject({ type: 'compaction', summary: 'old summary' });
    expect(events[0].itemId).toBe('compacted-0');
  });

  it('replays a remote-compaction row (empty message, encrypted summary) as a summary-less marker', () => {
    // Real 0.144 ChatGPT-account shape: `message` is empty and the summary rides
    // replacement_history as `{type:'compaction', encrypted_content}` — unrecoverable.
    const events = mapCodexHistoryEvents(HID, [
      {
        type: 'compacted',
        payload: {
          message: '',
          replacement_history: [{ type: 'compaction', encrypted_content: 'gAAAAA…' }],
          window_id: 'w-9',
          window_number: 1,
        },
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].event).toEqual({ type: 'compaction', compactionId: 'w-9' });
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
      { type: 'diff', change: 'add', path: 'new.txt', newText: 'line one\nline two' },
      {
        type: 'diff',
        change: 'move',
        path: 'new-name.txt',
        oldPath: 'old-name.txt',
        oldText: 'context\nbefore',
        newText: 'context\nafter',
      },
      { type: 'diff', change: 'delete', path: 'gone.txt' },
    ]);
  });

  it('splits multiple hunks of one file into one diff block per hunk', () => {
    const view = applyPatchToolView(
      '*** Begin Patch\n*** Update File: a.py\n@@\n-one\n+ONE\n@@\n-two\n+TWO\n*** End Patch\n',
    );
    expect(view?.content).toEqual([
      {
        type: 'diff',
        change: 'modify',
        path: 'a.py',
        oldPath: undefined,
        oldText: 'one',
        newText: 'ONE',
      },
      {
        type: 'diff',
        change: 'modify',
        path: 'a.py',
        oldPath: undefined,
        oldText: 'two',
        newText: 'TWO',
      },
    ]);
  });

  it('returns null for input that is not a Begin Patch envelope', () => {
    expect(applyPatchToolView('not a patch')).toBeNull();
    expect(applyPatchToolView('*** Begin Patch\n*** End Patch\n')).toBeNull();
  });
});
