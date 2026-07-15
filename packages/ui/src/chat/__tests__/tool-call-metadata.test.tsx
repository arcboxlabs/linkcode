// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallBody } from '../tool-call-item';
import { hasToolBody, toolCallSummary } from '../tool-utils';

function translateKey(key: string): string {
  return key;
}

function translationsMock(): typeof translateKey {
  return translateKey;
}

vi.mock('use-intl', () => ({
  useTranslations: translationsMock,
}));

const LiveTerminal = vi.fn(({ terminalId }: { terminalId: string }) => <div>{terminalId}</div>);

afterEach(() => {
  cleanup();
  LiveTerminal.mockClear();
});

describe('tool metadata policy', () => {
  it('shows search counts while hiding result paths and adapter timing', () => {
    const toolCall: ToolCall = {
      toolCallId: 'search-1',
      title: 'Search renderers',
      kind: 'search',
      status: 'completed',
      rawInput: { query: 'tool-call', glob: '**/*.tsx', cwd: '/repo' },
      rawOutput: {
        matches: ['packages/ui/src/chat/tool.tsx', 'packages/ui/src/chat/tool-call-item.tsx'],
        files: 2,
        elapsedMs: 17,
      },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('query')).toBeDefined();
    expect(screen.getByText('tool-call')).toBeDefined();
    expect(screen.getByText('matches')).toBeDefined();
    expect(screen.getByText('files')).toBeDefined();
    expect(container.textContent).not.toContain('tool-call-item.tsx');
    expect(container.textContent).not.toContain('elapsedMs');
    expect(container.textContent).not.toContain('glob');
  });

  it('shows curated fetch failure context without request or response envelopes', () => {
    const toolCall: ToolCall = {
      toolCallId: 'fetch-1',
      title: 'Fetch preview',
      kind: 'fetch',
      status: 'failed',
      rawInput: {
        url: 'https://mock.invalid/preview',
        headers: { authorization: 'Bearer mock-token' },
        traceId: 'trace-173',
      },
      rawOutput: {
        status: 503,
        message: 'Preview service unavailable',
        responseBody: '<internal diagnostic>',
      },
      content: [{ type: 'content', content: { type: 'text', text: 'Request attempted.' } }],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('url')).toBeDefined();
    expect(screen.getByText('https://mock.invalid/preview')).toBeDefined();
    expect(screen.getByText('status')).toBeDefined();
    expect(screen.getByText('503')).toBeDefined();
    expect(screen.getByText('Request attempted.')).toBeDefined();
    expect(screen.getByText('Preview service unavailable')).toBeDefined();
    expect(container.textContent).not.toContain('authorization');
    expect(container.textContent).not.toContain('trace-173');
    expect(container.textContent).not.toContain('responseBody');
  });

  it('keeps arbitrary custom-tool payloads out of normal-mode details', () => {
    const toolCall: ToolCall = {
      toolCallId: 'other-1',
      title: 'workspace.inspect',
      kind: 'other',
      status: 'completed',
      rawInput: { workspaceId: 'internal-42', includeDebug: true },
      rawOutput: { requestId: 'request-42', ok: true },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.textContent).toBe('');
    expect(hasToolBody(toolCall)).toBe(false);
  });

  it('projects Pi AgentToolResult content without exposing its details envelope', () => {
    const toolCall: ToolCall = {
      toolCallId: 'pi-read-1',
      title: 'read',
      kind: 'read',
      status: 'completed',
      rawOutput: {
        content: [{ type: 'text', text: 'Pi file contents', textSignature: 'opaque' }],
        details: { durationMs: 12, internalPath: '/private/result' },
      },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(hasToolBody(toolCall)).toBe(true);
    expect(screen.getByText('Pi file contents')).toBeDefined();
    expect(container.textContent).not.toContain('durationMs');
    expect(container.textContent).not.toContain('internalPath');
  });

  it('projects live Codex MCP result content without exposing its raw envelopes', () => {
    const toolCall: ToolCall = {
      toolCallId: 'codex-mcp-1',
      title: 'linear.get_issue',
      kind: 'other',
      status: 'completed',
      rawInput: { issueId: 'CODE-173', trace: true },
      rawOutput: {
        content: [{ type: 'text', text: 'CODE-173 is in progress' }],
        structuredContent: { internalId: 'opaque-173' },
      },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(hasToolBody(toolCall)).toBe(true);
    expect(screen.getByText('CODE-173 is in progress')).toBeDefined();
    expect(container.textContent).not.toContain('issueId');
    expect(container.textContent).not.toContain('structuredContent');
    expect(container.textContent).not.toContain('opaque-173');
  });

  it('keeps live execute calls on their terminal adapter without raw metadata', () => {
    const toolCall: ToolCall = {
      toolCallId: 'bash-live',
      title: 'Run focused tests',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'pnpm test', description: 'Internal execution description' },
      content: [{ type: 'terminal', terminalId: 'terminal-live' }],
    };

    const { container } = render(
      <ToolCallBody TerminalBlockComponent={LiveTerminal} toolCall={toolCall} />,
    );

    expect(LiveTerminal).toHaveBeenCalledWith({ terminalId: 'terminal-live' }, undefined);
    expect(container.textContent).toBe('terminal-live');
    expect(container.textContent).not.toContain('description');
  });

  it('provides curated context for singleton headers and activity groups', () => {
    const calls: ToolCall[] = [
      {
        toolCallId: 'read-summary',
        title: 'Read file',
        kind: 'read',
        status: 'completed',
        locations: [{ path: 'README.md', line: 3 }],
        content: [],
      },
      {
        toolCallId: 'search-summary',
        title: 'Search',
        kind: 'search',
        status: 'completed',
        rawInput: { query: 'ToolCallBody', debug: true },
        content: [],
      },
      {
        toolCallId: 'move-summary',
        title: 'Move file',
        kind: 'move',
        status: 'completed',
        rawInput: { path: 'old.ts', move_path: 'new.ts', overwrite: false },
        content: [],
      },
      {
        toolCallId: 'execute-summary',
        title: 'Bash',
        kind: 'execute',
        status: 'completed',
        rawInput: { command: ['pnpm', 'test'], description: 'hidden' },
        content: [],
      },
    ];

    expect(calls.map(toolCallSummary)).toEqual([
      'README.md:3',
      'ToolCallBody',
      'old.ts → new.ts',
      'pnpm test',
    ]);
  });
});
