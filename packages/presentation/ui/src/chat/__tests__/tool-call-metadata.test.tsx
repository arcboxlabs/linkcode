// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallBody, ToolCallItem } from '../tool-call-item';
import {
  hasToolBody,
  mcpToolName,
  toolCallContextSummary,
  toolCallHeaderSummary,
  toolCallMetadata,
} from '../tool-utils';

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
  it('previews search results while hiding adapter request and timing fields', () => {
    const toolCall: ToolCall = {
      toolCallId: 'search-1',
      title: 'Search renderers',
      kind: 'search',
      status: 'completed',
      rawInput: { query: 'tool-call', glob: '**/*.tsx', cwd: '/repo' },
      rawOutput: {
        matches: [
          'packages/presentation/ui/src/chat/tool.tsx',
          'packages/presentation/ui/src/chat/tool-call-item.tsx',
        ],
        files: 2,
        elapsedMs: 17,
      },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('query')).toBeDefined();
    expect(screen.getAllByText('tool-call')).toHaveLength(2);
    expect(screen.getByText('matches')).toBeDefined();
    expect(screen.getByText('files')).toBeDefined();
    expect(container.querySelector('pre')?.textContent).toContain(
      'packages/presentation/ui/src/chat/tool.tsx',
    );
    expect(container.querySelector('pre')?.textContent).toContain(
      'packages/presentation/ui/src/chat/tool-call-item.tsx',
    );
    expect(container.textContent).not.toContain('elapsedMs');
    expect(container.textContent).not.toContain('glob');
  });

  it('previews an allowlisted fetch response without exposing its envelopes', () => {
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
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('url')).toBeDefined();
    expect(screen.getAllByText('https://mock.invalid/preview')).toHaveLength(2);
    expect(screen.getByText('status')).toBeDefined();
    expect(screen.getByText('503')).toBeDefined();
    expect(screen.getByText('<internal diagnostic>')).toBeDefined();
    expect(screen.getByText('Preview service unavailable')).toBeDefined();
    expect(container.textContent).not.toContain('authorization');
    expect(container.textContent).not.toContain('trace-173');
    expect(container.textContent).not.toContain('responseBody');
  });

  it('shows scalar input params for custom tools while keeping the output envelope curated', () => {
    const toolCall: ToolCall = {
      toolCallId: 'other-1',
      title: 'workspace.inspect',
      kind: 'other',
      status: 'completed',
      rawInput: {
        workspaceId: 'internal-42',
        includeDebug: true,
        options: { nested: 'hidden' },
        tags: ['also-hidden'],
      },
      rawOutput: { requestId: 'request-42', structuredContent: { ok: true } },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('pre')?.textContent).toContain('"ok": true');
    // Scalar inputs are the call's headline details; nested envelopes stay hidden.
    expect(screen.getByText('workspaceId')).toBeDefined();
    expect(screen.getByText('internal-42')).toBeDefined();
    expect(screen.getByText('includeDebug')).toBeDefined();
    expect(container.textContent).not.toContain('nested');
    expect(container.textContent).not.toContain('also-hidden');
    expect(container.textContent).not.toContain('request-42');
    expect(hasToolBody(toolCall)).toBe(true);
  });

  it('prefers canonical OpenCode content over its duplicate raw string', () => {
    const toolCall: ToolCall = {
      toolCallId: 'opencode-read-1',
      title: 'read',
      kind: 'read',
      status: 'completed',
      locations: [{ path: 'notes.md' }],
      rawOutput: 'Canonical result',
      content: [{ type: 'content', content: { type: 'text', text: 'Canonical result' } }],
    };

    render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getAllByText('Canonical result')).toHaveLength(1);
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

  it('projects live Codex MCP result content without exposing its raw output envelope', () => {
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
    expect(screen.getByText('issueId')).toBeDefined();
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

  it('keeps a completed execute message reachable without a command', () => {
    const toolCall: ToolCall = {
      toolCallId: 'bash-message',
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawOutput: { exitCode: 1, message: 'command unavailable' },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(hasToolBody(toolCall)).toBe(true);
    expect(container.querySelector('pre')?.textContent).toBe('command unavailable');
    expect(container.textContent).not.toContain('exitCode');
  });

  it('badges a Claude WebFetch envelope as status, duration, and size', () => {
    const toolCall: ToolCall = {
      toolCallId: 'fetch-envelope',
      title: 'WebFetch',
      kind: 'fetch',
      status: 'completed',
      rawInput: { url: 'https://en.wikipedia.org/wiki/Arknights' },
      rawOutput: {
        bytes: 192511,
        code: 200,
        codeText: 'OK',
        durationMs: 5404,
        url: 'https://en.wikipedia.org/wiki/Arknights',
      },
      content: [],
    };

    expect(toolCallMetadata(toolCall)).toEqual([
      { key: 'url', value: 'https://en.wikipedia.org/wiki/Arknights' },
      { key: 'status', value: '200 OK', tone: undefined },
      { key: 'duration', value: '5.4s' },
      { key: 'size', value: '193 kB' },
    ]);
  });

  it('splits Claude MCP slugs into server and tool, leaving other titles alone', () => {
    expect(mcpToolName('mcp__linear__get_issue')).toEqual({ server: 'linear', tool: 'get_issue' });
    expect(mcpToolName('mcp__ccd_session__spawn_task')).toEqual({
      server: 'ccd_session',
      tool: 'spawn_task',
    });
    expect(mcpToolName('mcp__f5fcc7d5-d616__list_issue_labels')).toEqual({
      server: 'f5fcc7d5-d616',
      tool: 'list_issue_labels',
    });
    expect(mcpToolName('WebFetch')).toBeUndefined();
    expect(mcpToolName('mcp__broken')).toBeUndefined();
    expect(mcpToolName('mcp__server__')).toBeUndefined();
    expect(mcpToolName('linear_get_issue')).toBeUndefined();
  });

  it('headlines an MCP call with its tool name, server context, and an MCP badge', () => {
    const toolCall: ToolCall = {
      toolCallId: 'mcp-1',
      title: 'mcp__linear__get_issue',
      kind: 'other',
      status: 'completed',
      rawInput: { id: 'CODE-228' },
      content: [],
    };

    // The server context sits beside a visible tool name only; a collapsed group join (which
    // shows summaries INSTEAD of names) must fall through to the tool name itself.
    expect(toolCallHeaderSummary(toolCall)).toBeUndefined();
    expect(toolCallContextSummary(toolCall)).toEqual({
      label: 'linear',
      tooltip: 'mcp__linear__get_issue',
    });

    const { container } = render(<ToolCallItem toolCall={toolCall} />);
    expect(screen.getByText('get_issue')).toBeDefined();
    expect(screen.getByText('MCP')).toBeDefined();
    expect(screen.getByText('· linear')).toBeDefined();
    expect(container.textContent).not.toContain('mcp__linear__get_issue');
    expect(container.textContent).not.toContain('kindOther');
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

    expect(calls.map(toolCallHeaderSummary)).toEqual([
      { label: 'README.md:3', tooltip: 'README.md:3' },
      { label: 'ToolCallBody' },
      { label: 'old.ts → new.ts', tooltip: 'old.ts → new.ts' },
      { label: 'pnpm test' },
    ]);
    expect(toolCallMetadata(calls[0])).toEqual([]);
    expect(toolCallMetadata(calls[2])).toEqual([]);
  });
});
