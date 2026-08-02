// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasToolBody } from '../../tool-utils';
import { ToolCallBody, ToolCallItem } from '../tool-call-item';

function translateKey(key: string): string {
  return key;
}

function translationsMock(): typeof translateKey {
  return translateKey;
}

vi.mock('use-intl', () => ({
  useTranslations: translationsMock,
}));

afterEach(cleanup);

function toolSearch(overrides: Partial<ToolCall>): ToolCall {
  return {
    toolCallId: 'toolsearch-1',
    title: 'ToolSearch',
    kind: 'search',
    status: 'completed',
    content: [],
    rawInput: { query: 'select:WebSearch,mcp__linear__get_issue' },
    rawOutput: { query: 'select:WebSearch,mcp__linear__get_issue', total_deferred_tools: 110 },
    ...overrides,
  };
}

describe('tool search presentation', () => {
  it('humanizes a settled select call and never shows the raw query', () => {
    const toolCall = toolSearch({
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'WebSearch\nmcp__linear__get_issue' },
        },
      ],
    });

    const { container } = render(<ToolCallItem toolCall={toolCall} />);

    expect(screen.getByText('toolSearch.selected')).toBeDefined();
    expect(container.textContent).not.toContain('select:');
    expect(container.textContent).not.toContain('ToolSearch');
  });

  it('shows the keyword query beside a humanized search header', () => {
    const toolCall = toolSearch({
      rawInput: { query: 'Linear issues search' },
      content: [{ type: 'content', content: { type: 'text', text: 'WebSearch' } }],
    });

    render(<ToolCallItem toolCall={toolCall} />);

    expect(screen.getByText('toolSearch.searched')).toBeDefined();
    expect(screen.getByText('· Linear issues search')).toBeDefined();
  });

  it('renders loaded tools as one inline line with split MCP identity', () => {
    const toolCall = toolSearch({
      content: [
        {
          type: 'content',
          content: { type: 'text', text: 'WebSearch\nmcp__linear__get_issue' },
        },
      ],
    });

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('p')?.textContent).toBe('WebSearch, get_issue (linear)');
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.queryByText('query')).toBeNull();
  });

  it('shows a zero-match settle as the tool message', () => {
    const toolCall = toolSearch({
      rawInput: { query: '+jupyter notebook edit' },
      content: [
        { type: 'content', content: { type: 'text', text: 'No matching deferred tools found' } },
      ],
    });

    render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('No matching deferred tools found')).toBeDefined();
  });

  it('keeps a running call body-less with a progressive header', () => {
    const toolCall = toolSearch({ status: 'in_progress', rawOutput: undefined });

    render(<ToolCallItem toolCall={toolCall} />);

    expect(hasToolBody(toolCall)).toBe(false);
    expect(screen.getByText('toolSearch.selecting')).toBeDefined();
  });

  it('uses neutral wording and error prose for a failed selection', () => {
    const toolCall = toolSearch({
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'unavailable' } }],
    });

    render(<ToolCallItem toolCall={toolCall} />);

    expect(screen.getByText('toolSearch.select')).toBeDefined();
    expect(screen.queryByText('toolSearch.selected')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('unavailable')).toBeDefined();
  });

  it('uses neutral wording when a keyword search is declined', () => {
    const toolCall = toolSearch({
      status: 'in_progress',
      rawInput: { query: 'Linear issues search' },
      rawOutput: undefined,
    });

    render(<ToolCallItem declined toolCall={toolCall} />);

    expect(screen.getByText('toolSearch.search')).toBeDefined();
    expect(screen.queryByText('toolSearch.searching')).toBeNull();
    expect(screen.queryByText('toolSearch.searched')).toBeNull();
  });
});
