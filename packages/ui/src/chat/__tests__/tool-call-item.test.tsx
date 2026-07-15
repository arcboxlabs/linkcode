// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactHostActionsProvider } from '../artifacts/context';
import { SubagentTranscript } from '../subagent-card';
import { ToolCallBody, ToolCallItem } from '../tool-call-item';
import { hasToolBody } from '../tool-utils';

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
const RE_ANSWER_SOURCE_HEADER = /^answer\.ts/;
const RE_APPLY_GUARDED_EDIT = /^Apply guarded edit/;
const RE_DELETE_LEGACY = /^Delete legacy/;
const RE_EDITED_GONE_PREVIEW = /^edited\.ts, gone\.ts$/;
const RE_FAILED_MOVE_PREVIEW = /^old\.ts → new\.ts$/;
const RE_FIRST_SECOND_PREVIEW = /^first\.ts, second\.ts$/;
const RE_LEGACY_PREVIEW = /^legacy\.ts/;
const RE_MOVE = /^Move file/;
const RE_MOVE_PREVIEW = /^target\.ts → moved\.ts$/;
const RE_READ = /^Read/;
const RE_TARGET_PREVIEW_HEADER = /^target\.ts/;
const RE_WRITE_PLAN = /^Write PLAN/;

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

  it('renders file-path metadata as a header-only preview', () => {
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

    expect(hasToolBody(toolCall)).toBe(true);
    expect(screen.getByText('README.md:12')).toBeDefined();
    expect(container.textContent).not.toContain('offset');
    expect(container.textContent).not.toContain('debug');
  });

  it('renders source reads literally and opens them from the basename header', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const source = '# not-a-heading\nconst answer = 42;';
    const path = '/repo/src/answer.ts';
    const toolCall: ToolCall = {
      toolCallId: 'read-source',
      title: 'Read',
      kind: 'read',
      status: 'completed',
      locations: [{ path }],
      rawInput: { file_path: path },
      content: [
        {
          type: 'content',
          content: { type: 'text', text: '1\t# not-a-heading\n2\tconst answer = 42;' },
        },
      ],
    };

    const { container } = render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallItem toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    const peekHeader = screen.getByRole('button', { name: RE_READ });
    expect(peekHeader.textContent).toContain('answer.ts');
    expect(peekHeader.textContent).not.toContain('/repo');
    expect(screen.queryByText(path)).toBeNull();

    await user.click(peekHeader);
    const previewHeader = screen.getByRole('button', { name: RE_ANSWER_SOURCE_HEADER });
    expect(previewHeader.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    await user.hover(previewHeader);
    expect(await screen.findByText(path)).toBeDefined();
    await user.click(previewHeader);

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(source);
    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith(path);
  });

  it('renders pathless reads literally instead of interpreting Markdown-looking output', () => {
    const source = '# not-a-heading\nconst answer = 42;';
    const toolCall: ToolCall = {
      toolCallId: 'read-pathless',
      title: 'Read output',
      kind: 'read',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: source } }],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(source);
  });

  it('renders Markdown file reads as a document preview', () => {
    const toolCall: ToolCall = {
      toolCallId: 'read-markdown',
      title: 'Read',
      kind: 'read',
      status: 'completed',
      locations: [{ path: '/repo/docs/preview.md' }],
      rawInput: { file_path: '/repo/docs/preview.md' },
      content: [
        {
          type: 'content',
          content: { type: 'text', text: '1\t# Preview\n2\t\n3\t- First item' },
        },
      ],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    expect(container.querySelector('h1')?.textContent).toBe('Preview');
    expect(container.querySelector('li')?.textContent).toBe('First item');
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.getByText('preview.md')).toBeDefined();
    expect(screen.queryByText('/repo/docs/preview.md')).toBeNull();
    const tooltipTrigger = screen
      .getByText('preview.md')
      .closest<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(tooltipTrigger?.tabIndex).toBe(-1);
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
  it('opens a path-only write from its header-only preview', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const toolCall: ToolCall = {
      toolCallId: 'write-plan',
      title: 'Write PLAN.md',
      kind: 'edit',
      status: 'completed',
      locations: [{ path: 'PLAN.md' }],
      rawInput: { file_path: 'PLAN.md' },
      content: [],
    };

    render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallItem toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: RE_WRITE_PLAN }));
    const previewHeader = screen.getByRole('button', { name: 'PLAN.md' });
    previewHeader.focus();
    await user.keyboard('{Enter}');

    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith('PLAN.md');
  });

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
    expect(headerText).toContain('target.ts');
    expect(headerText).not.toContain('packages/ui/src/chat');
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
    const previewHeader = screen.getByRole('button', { name: RE_TARGET_PREVIEW_HEADER });
    await user.hover(previewHeader);
    expect(await screen.findByText(path)).toBeDefined();
    await user.click(previewHeader);

    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith(path);
  });

  it('keeps a completed move destination reachable around a non-text result', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const source = 'packages/ui/src/chat/target.ts';
    const destination = 'packages/ui/src/chat/moved.ts';
    const toolCall: ToolCall = {
      toolCallId: 'move-1',
      title: 'Move file',
      kind: 'move',
      status: 'completed',
      locations: [{ path: source }],
      rawInput: { path: source, move_path: destination },
      content: [
        {
          type: 'content',
          content: {
            type: 'resource_link',
            uri: 'https://example.test/move-receipt',
            name: 'Move receipt',
          },
        },
      ],
    };

    const { container } = render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallItem toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: RE_MOVE }));
    await user.click(screen.getByRole('button', { name: RE_MOVE_PREVIEW }));

    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith(destination);
    expect(container.textContent).not.toContain('packages/ui/src/chat');
  });

  it('opens the surviving source after a move fails', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const source = '/repo/old.ts';
    const toolCall: ToolCall = {
      toolCallId: 'move-failed',
      title: 'Move file',
      kind: 'move',
      status: 'failed',
      rawInput: { path: source, move_path: '/repo/new.ts' },
      content: [],
    };

    render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallItem toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: RE_MOVE }));
    await user.click(screen.getByRole('button', { name: RE_FAILED_MOVE_PREVIEW }));

    expect(openFile).toHaveBeenCalledWith(source);
  });

  it('routes multi-file text receipts through one aggregate review header', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const reviewChanges = vi.fn();
    const toolCall: ToolCall = {
      toolCallId: 'multi-file-receipts',
      title: 'Apply file changes',
      kind: 'edit',
      status: 'completed',
      locations: [{ path: '/repo/first.ts' }, { path: '/repo/second.ts' }],
      content: [
        { type: 'content', content: { type: 'text', text: 'Renamed the first file' } },
        { type: 'content', content: { type: 'text', text: 'Renamed the second file' } },
      ],
    };

    const { container } = render(
      <ArtifactHostActionsProvider
        actions={{ referenceToComposer: vi.fn(), openFile, reviewChanges }}
      >
        <ToolCallBody toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    expect(screen.getByText('Renamed the first file')).toBeDefined();
    expect(screen.getByText('Renamed the second file')).toBeDefined();
    await user.click(screen.getByRole('button', { name: RE_FIRST_SECOND_PREVIEW }));
    expect(container.textContent).not.toContain('/repo');
    expect(openFile).not.toHaveBeenCalled();
    expect(reviewChanges).toHaveBeenCalledOnce();
  });

  it('keeps an aggregate review header beside mixed Codex diffs and delete receipts', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const reviewChanges = vi.fn();
    const editedPath = 'packages/ui/edited.ts';
    const deletedPath = 'packages/ui/gone.ts';
    const toolCall: ToolCall = {
      toolCallId: 'mixed-codex-patch',
      title: 'Apply file changes',
      kind: 'edit',
      status: 'completed',
      locations: [{ path: editedPath }, { path: deletedPath }],
      content: [
        {
          type: 'diff',
          path: editedPath,
          oldText: 'before\n',
          newText: 'after\n',
        },
        {
          type: 'content',
          content: { type: 'text', text: `Deleted ${deletedPath}` },
        },
      ],
    };

    render(
      <ArtifactHostActionsProvider
        actions={{ referenceToComposer: vi.fn(), openFile, reviewChanges }}
      >
        <ToolCallBody toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    expect(screen.getByText(`Deleted ${deletedPath}`)).toBeDefined();
    await user.click(screen.getByRole('button', { name: RE_EDITED_GONE_PREVIEW }));
    expect(reviewChanges).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
  });

  it('routes a Codex history delete receipt to the diff viewer', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const reviewChanges = vi.fn();
    const path = 'packages/ui/src/chat/gone.ts';
    const toolCall: ToolCall = {
      toolCallId: 'codex-delete-receipt',
      title: 'Apply file changes',
      kind: 'edit',
      status: 'completed',
      locations: [{ path }],
      content: [{ type: 'content', content: { type: 'text', text: `Deleted ${path}` } }],
    };

    render(
      <ArtifactHostActionsProvider
        actions={{ referenceToComposer: vi.fn(), openFile, reviewChanges }}
      >
        <ToolCallBody toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'gone.ts' }));
    expect(reviewChanges).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
  });

  it('opens completed deletions in the diff viewer instead of the missing file', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const reviewChanges = vi.fn();
    const path = '/repo/legacy.ts';
    const toolCall: ToolCall = {
      toolCallId: 'delete-legacy',
      title: 'Delete legacy file',
      kind: 'delete',
      status: 'completed',
      content: [{ type: 'diff', path, oldText: 'legacy\n', newText: '' }],
    };

    render(
      <ArtifactHostActionsProvider
        actions={{ referenceToComposer: vi.fn(), openFile, reviewChanges }}
      >
        <ToolCallItem toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    await user.click(screen.getByRole('button', { name: RE_DELETE_LEGACY }));
    await user.click(screen.getByRole('button', { name: RE_LEGACY_PREVIEW }));

    expect(reviewChanges).toHaveBeenCalledOnce();
    expect(openFile).not.toHaveBeenCalled();
  });
});

describe('SubagentTranscript', () => {
  const taskToolCall: ToolCall = {
    toolCallId: 'task-1',
    title: 'Review previews',
    kind: 'task',
    status: 'completed',
    rawOutput: 'Final review report',
    content: [],
  };
  const sharedProps = {
    awaitingApproval: new Set<string>(),
    childrenByParent: new Map(),
    declined: new Set<string>(),
    toolCall: taskToolCall,
  };

  it('uses the task result as the empty-transcript fallback', () => {
    render(<SubagentTranscript {...sharedProps} items={[]} />);

    expect(screen.getByText('Final review report')).toBeDefined();
  });

  it('does not repeat the task result after the transcript report', () => {
    render(
      <SubagentTranscript
        {...sharedProps}
        items={[
          {
            id: 'message-1',
            kind: 'message',
            role: 'assistant',
            turnId: null,
            isStreaming: false,
            blocks: [{ type: 'text', text: 'Final review report' }],
          },
        ]}
      />,
    );

    expect(screen.getAllByText('Final review report')).toHaveLength(1);
  });

  it('appends the task result when a partial transcript does not contain it', () => {
    render(
      <SubagentTranscript
        {...sharedProps}
        items={[
          {
            id: 'message-1',
            kind: 'message',
            role: 'assistant',
            turnId: null,
            isStreaming: false,
            blocks: [{ type: 'text', text: 'Reviewed the preview boundary.' }],
          },
        ]}
      />,
    );

    expect(screen.getByText('Reviewed the preview boundary.')).toBeDefined();
    expect(screen.getByText('Final review report')).toBeDefined();
  });

  it('does not mistake private reasoning for the user-facing task report', () => {
    render(
      <SubagentTranscript
        {...sharedProps}
        items={[
          {
            id: 'reasoning-1',
            kind: 'reasoning',
            turnId: null,
            isStreaming: false,
            blocks: [{ type: 'text', text: 'Final review report' }],
          },
        ]}
      />,
    );

    expect(screen.getAllByText('Final review report')).toHaveLength(2);
  });
});
