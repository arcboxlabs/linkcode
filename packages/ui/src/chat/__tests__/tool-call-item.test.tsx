// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallBody } from '../tool-call-item';

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

describe('ToolCallBody', () => {
  it('presents execute metadata and output as a read-only terminal', () => {
    const command = 'fd -e ts packages | xargs wc -l';
    const output = '74646 total\npackages/ui: 20155';
    const toolCall: ToolCall = {
      toolCallId: 'bash-1',
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawInput: { command, description: 'Count TypeScript lines' },
      rawOutput: output,
      content: [{ type: 'content', content: { type: 'text', text: output } }],
    };

    const { container } = render(
      <ToolCallBody TerminalBlockComponent={LiveTerminal} toolCall={toolCall} />,
    );

    expect(screen.getByText(command)).toBeDefined();
    expect(container.querySelector('pre')?.textContent).toBe(output);
    expect(screen.queryByText('input')).toBeNull();
    expect(container.textContent).not.toContain('"description"');
    expect(LiveTerminal).not.toHaveBeenCalled();
  });

  it('projects file metadata without exposing the raw read request', () => {
    const toolCall: ToolCall = {
      toolCallId: 'read-1',
      title: 'Read file',
      kind: 'read',
      status: 'completed',
      locations: [{ path: 'README.md', line: 12 }],
      rawInput: { path: 'README.md', offset: 11, limit: 200, debug: true },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('path')).toBeDefined();
    expect(screen.getByText('README.md:12')).toBeDefined();
    expect(screen.queryByText('input')).toBeNull();
    expect(container.textContent).not.toContain('offset');
    expect(container.textContent).not.toContain('debug');
  });

  it('surfaces an execute failure message without its raw result envelope', () => {
    const toolCall: ToolCall = {
      toolCallId: 'bash-2',
      title: 'Bash',
      kind: 'execute',
      status: 'failed',
      rawInput: { command: 'pnpm typecheck' },
      rawOutput: { exitCode: 1, message: 'stale preview import' },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('pre')?.textContent).toBe('stale preview import');
    expect(container.textContent).not.toContain('exitCode');
  });
});
