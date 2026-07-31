import type { ToolCall } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  toolCallDisplayContent,
  toolCallDisplayText,
  toolCallExecuteText,
  toolCallReadPreviewText,
  toolSearchPresentation,
} from '../tool-result-content';

function call(overrides: Partial<ToolCall>): ToolCall {
  return {
    toolCallId: 'tool-1',
    title: 'Tool',
    kind: 'other',
    status: 'completed',
    content: [],
    ...overrides,
  };
}

describe('tool result content policy', () => {
  it('prefers canonical content over duplicate adapter output', () => {
    const toolCall = call({
      kind: 'read',
      rawOutput: 'duplicate',
      content: [{ type: 'content', content: { type: 'text', text: 'canonical' } }],
    });

    expect(toolCallDisplayText(toolCall)).toBe('canonical');
  });

  it('projects Pi and live Codex MCP content without their envelopes', () => {
    const toolCall = call({
      rawOutput: {
        content: [{ type: 'text', text: 'projected', textSignature: 'opaque' }],
        details: { durationMs: 12 },
      },
    });

    expect(toolCallDisplayContent(toolCall)).toEqual([
      { type: 'content', content: { type: 'text', text: 'projected' } },
    ]);
  });

  it('projects only kind-specific structured result fields', () => {
    expect(
      toolCallDisplayText(
        call({ kind: 'search', rawOutput: { matches: ['a.ts', 'b.ts'], elapsedMs: 4 } }),
      ),
    ).toBe('a.ts\nb.ts');
    expect(
      toolCallDisplayText(
        call({ kind: 'fetch', rawOutput: { responseBody: { ok: true }, traceId: 'hidden' } }),
      ),
    ).toBe('{\n  "ok": true\n}');
    expect(
      toolCallDisplayText(
        call({
          kind: 'other',
          rawOutput: { structuredContent: { count: 2 }, requestId: 'hidden' },
        }),
      ),
    ).toBe('{\n  "count": 2\n}');
  });

  it('does not present arbitrary envelopes or scalar execute exit codes', () => {
    expect(
      toolCallDisplayContent(call({ kind: 'read', rawOutput: { details: 'hidden' } })),
    ).toEqual([]);
    expect(toolCallDisplayContent(call({ kind: 'execute', rawOutput: 0 }))).toEqual([]);
  });

  it('projects the exact execute message field without its result envelope', () => {
    expect(
      toolCallExecuteText(
        call({ kind: 'execute', rawOutput: { exitCode: 1, message: 'command failed' } }),
      ),
    ).toBe('command failed');
  });

  it('unwraps a complete Claude Read line-number sequence', () => {
    const toolCall = call({
      kind: 'read',
      title: 'Read',
      rawInput: { file_path: '/repo/docs/preview.md', offset: 7 },
    });

    expect(
      toolCallReadPreviewText(toolCall, '7\t# Preview\r\n8\t\r\n9\t1. First\r\n10\t2. Second\r\n'),
    ).toBe('# Preview\r\n\r\n1. First\r\n2. Second\r\n');
    expect(toolCallReadPreviewText(toolCall, '7\t7\talpha\n8\t8\tbeta')).toBe('7\talpha\n8\tbeta');
    expect(toolCallReadPreviewText(toolCall, '7\talpha\r99\tbeta\u{2028}123\tgamma')).toBe(
      'alpha\r99\tbeta\u{2028}123\tgamma',
    );
    expect(
      toolCallReadPreviewText(
        toolCall,
        '<system-reminder>Provider metadata.</system-reminder>\n7\t# Preview\n8\t',
      ),
    ).toBe('# Preview\n');
  });

  it('preserves non-Claude and incomplete numbered content', () => {
    const text = '1\talpha\n2\tbeta';
    expect(
      toolCallReadPreviewText(
        call({ kind: 'read', title: 'read', rawInput: { path: '/repo/data.tsv' } }),
        text,
      ),
    ).toBe(text);
    expect(
      toolCallReadPreviewText(
        call({ kind: 'read', title: 'Read', rawInput: { file_path: '/repo/data.tsv' } }),
        '1\talpha\n3\tbeta',
      ),
    ).toBe('1\talpha\n3\tbeta');
    const reminder = '<system-reminder>Short-offset warning.</system-reminder>';
    expect(
      toolCallReadPreviewText(
        call({ kind: 'read', title: 'Read', rawInput: { file_path: '/repo/data.tsv' } }),
        reminder,
      ),
    ).toBe(reminder);
  });
});

describe('tool search presentation', () => {
  function toolSearch(overrides: Partial<ToolCall>): ToolCall {
    return call({
      title: 'ToolSearch',
      kind: 'search',
      rawInput: { query: 'select:WebSearch' },
      ...overrides,
    });
  }

  it('splits a settled name-per-line result into deduplicated rows', () => {
    const toolCall = toolSearch({
      content: [
        {
          type: 'content',
          content: {
            type: 'text',
            text: 'WebSearch\nmcp__linear__get_issue\nWebSearch',
          },
        },
      ],
    });

    expect(toolSearchPresentation(toolCall)).toEqual({
      query: 'select:WebSearch',
      mode: 'select',
      names: ['WebSearch', 'mcp__linear__get_issue'],
    });
  });

  it('keeps prose settles as a message instead of rows', () => {
    const toolCall = toolSearch({
      rawInput: { query: '+jupyter notebook edit' },
      content: [
        { type: 'content', content: { type: 'text', text: 'No matching deferred tools found' } },
      ],
    });

    expect(toolSearchPresentation(toolCall)).toEqual({
      query: '+jupyter notebook edit',
      mode: 'search',
      names: [],
      message: 'No matching deferred tools found',
    });
  });

  it('presents a running call with neither rows nor message', () => {
    expect(toolSearchPresentation(toolSearch({ status: 'in_progress' }))).toEqual({
      query: 'select:WebSearch',
      mode: 'select',
      names: [],
      message: undefined,
    });
  });

  it('matches only the exact Claude title and input shape', () => {
    expect(toolSearchPresentation(toolSearch({ title: 'Grep' }))).toBeUndefined();
    expect(toolSearchPresentation(toolSearch({ kind: 'other' }))).toBeUndefined();
    expect(toolSearchPresentation(toolSearch({ rawInput: { pattern: 'x' } }))).toBeUndefined();
  });
});
