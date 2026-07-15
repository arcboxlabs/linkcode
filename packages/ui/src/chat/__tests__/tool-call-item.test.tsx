// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactHostActionsProvider } from '../artifacts/context';
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

const LiveTerminal = vi.fn(({ terminalId }: { terminalId: string }) => <div>{terminalId}</div>);
const RE_APPLY_GUARDED_EDIT = /^Apply guarded edit/;

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

  it('renders source reads literally instead of interpreting Markdown-looking code', () => {
    const source = '# not-a-heading\nconst answer = 42;';
    const toolCall: ToolCall = {
      toolCallId: 'read-source',
      title: 'Read source',
      kind: 'read',
      status: 'completed',
      locations: [{ path: 'src/answer.ts' }],
      content: [{ type: 'content', content: { type: 'text', text: source } }],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(screen.getAllByText('src/answer.ts')).toHaveLength(2);
  });

  it('renders Markdown file reads as a document preview', () => {
    const toolCall: ToolCall = {
      toolCallId: 'read-markdown',
      title: 'Read document',
      kind: 'read',
      status: 'completed',
      locations: [{ path: 'docs/preview.md' }],
      content: [{ type: 'content', content: { type: 'text', text: '# Preview\n\n- First item' } }],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('h1')?.textContent).toBe('Preview');
    expect(container.querySelector('li')?.textContent).toBe('First item');
    expect(container.querySelector('pre')).toBeNull();
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

  it('renders Pi execute output from its AgentToolResult content', () => {
    const toolCall: ToolCall = {
      toolCallId: 'pi-bash-1',
      title: 'bash',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'pnpm test' },
      rawOutput: {
        content: [{ type: 'text', text: '825 tests passed' }],
        details: { exitCode: 0 },
      },
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('pre')?.textContent).toBe('825 tests passed');
    expect(container.textContent).not.toContain('exitCode');
  });

  it('does not mistake a Codex scalar exit code for terminal output', () => {
    const toolCall: ToolCall = {
      toolCallId: 'codex-exit-1',
      title: 'Bash',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'true' },
      rawOutput: 0,
      content: [],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(screen.getByText('true')).toBeDefined();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).not.toContain('0');
  });
});

describe('ToolCallItem', () => {
  it('summarizes a standalone edit without a redundant file artifact card', () => {
    const toolCall: ToolCall = {
      toolCallId: 'edit-1',
      title: 'Apply guarded edit',
      kind: 'edit',
      status: 'completed',
      content: [
        {
          type: 'diff',
          path: 'packages/ui/src/chat/target.ts',
          oldText: "const coverage = 'thin';\n",
          newText: "const coverage = 'rich';\n",
        },
      ],
    };

    render(<ToolCallItem toolCall={toolCall} />);

    const headerText = screen.getByRole('button', { name: RE_APPLY_GUARDED_EDIT }).textContent;
    expect(screen.getByText('+1')).toBeDefined();
    expect(screen.getByText('-1')).toBeDefined();
    expect(headerText.indexOf('+1')).toBeLessThan(
      headerText.indexOf('packages/ui/src/chat/target.ts'),
    );
    expect(screen.queryByText('target.ts')).toBeNull();
  });

  it('opens an edited file from the shared diff header', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const path = 'packages/ui/src/chat/target.ts';
    const toolCall: ToolCall = {
      toolCallId: 'edit-open-1',
      title: 'Apply guarded edit',
      kind: 'edit',
      status: 'completed',
      content: [
        {
          type: 'diff',
          path,
          oldText: "const coverage = 'thin';\n",
          newText: "const coverage = 'rich';\n",
        },
      ],
    };

    render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallItem toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: RE_APPLY_GUARDED_EDIT }));
    await user.click(screen.getByTitle('openFile'));

    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith(path);
  });

  it('keeps the produced-file artifact for a completed move', () => {
    const toolCall: ToolCall = {
      toolCallId: 'move-1',
      title: 'Move file',
      kind: 'move',
      status: 'completed',
      locations: [{ path: 'packages/ui/src/chat/moved.ts' }],
      rawInput: { path: 'target.ts', move_path: 'packages/ui/src/chat/moved.ts' },
      content: [],
    };

    render(<ToolCallItem toolCall={toolCall} />);

    expect(screen.getByText('moved.ts')).toBeDefined();
  });
});
