// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactHostActionsProvider } from '../artifacts/context';
import { FileArtifactCard } from '../artifacts/file-card';
import type { QuestionConversationItem } from '../conversation-prompts';
import { QuestionCallItem } from '../question-call-item';
import { SubagentCard, SubagentTranscript } from '../subagent-card';
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
const RE_BASH = /^Bash/;
const RE_DELETE_LEGACY = /^Delete legacy/;
const RE_EDITED_GONE_PREVIEW = /^edited\.ts, gone\.ts$/;
const RE_FAILED_MOVE_PREVIEW = /^old\.ts → new\.ts$/;
const RE_FIRST_SECOND_PREVIEW = /^first\.ts, second\.ts$/;
const RE_LEGACY_PREVIEW = /^legacy\.ts/;
const RE_SUBAGENT_LABEL = /^label/;
const RE_MOVE = /^Move file/;
const RE_MOVE_PREVIEW = /^target\.ts → moved\.ts$/;
const RE_QUESTION_CALL_TITLE = /^callTitle/;
const RE_READ = /^Read/;
const RE_TARGET_PREVIEW_HEADER = /^target\.ts/;
const RE_THINKING_PUBLIC_SUMMARY = /thinking.*Reviewing public results/;
const RE_WRITE_PLAN = /^Write PLAN/;

afterEach(() => {
  cleanup();
  LiveTerminal.mockClear();
});

describe('ToolCallBody', () => {
  it('presents execute metadata and output as a read-only terminal', () => {
    const command = 'fd -e ts packages | xargs wc -l';
    const output = '74646 total\npackages/presentation/ui: 20155';
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
    const scrollArea = container.querySelector('[data-slot="chat-disclosure-scroll"]');
    const viewport = scrollArea?.querySelector('[data-slot="scroll-area-viewport"]');
    expect(scrollArea?.className).toContain('max-h-96');
    expect(scrollArea?.className).toContain('**:data-[slot=scroll-area-viewport]:max-h-96');
    expect(viewport?.className).toContain('mask-t-from');
    expect(viewport?.className).toContain('mask-b-from');
    const previewHeader = screen.getByRole('button', { name: RE_ANSWER_SOURCE_HEADER });
    expect(previewHeader.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    await user.hover(previewHeader);
    expect(await screen.findByText(path)).toBeDefined();
    await user.click(previewHeader);

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('pre')?.textContent).toBe(source);
    await waitFor(
      () => {
        expect(container.querySelectorAll('code span[style*="--sdm-c"]').length).toBeGreaterThan(2);
      },
      { timeout: 10000 },
    );
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

  it('highlights structured JSON tool results', async () => {
    const toolCall: ToolCall = {
      toolCallId: 'json-result',
      title: 'Inspect package metadata',
      kind: 'other',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: { type: 'text', text: '{"name":"@linkcode/ui","private":true}' },
        },
      ],
    };

    const { container } = render(<ToolCallBody toolCall={toolCall} />);

    await waitFor(
      () => {
        expect(container.querySelectorAll('code span[style*="--sdm-c"]').length).toBeGreaterThan(2);
      },
      { timeout: 10000 },
    );
  }, 15000);

  it('highlights embedded text resources from their MIME type', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const toolCall: ToolCall = {
      toolCallId: 'resource-result',
      title: 'Load manifest',
      kind: 'other',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: {
            type: 'resource',
            resource: {
              uri: 'https://example.test/manifest.json?token=secret',
              mimeType: 'application/json',
              text: '{"enabled":true}',
            },
          },
        },
      ],
    };

    const { container } = render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallBody toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    const resourceLabel = screen.getByText('manifest.json');
    const resourceCard = resourceLabel.closest('[data-slot="frame"]');
    const resourceHeader = resourceLabel.closest<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(resourceCard?.querySelector('[data-slot="frame-panel"]')).not.toBeNull();
    expect(resourceHeader?.tabIndex).toBe(0);
    expect(screen.queryByText('https://example.test/manifest.json?token=secret')).toBeNull();
    await user.hover(resourceHeader!);
    expect(
      await screen.findByText('https://example.test/manifest.json?token=secret'),
    ).toBeDefined();
    await user.click(resourceHeader!);
    expect(openFile).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(container.querySelectorAll('code span[style*="--sdm-c"]').length).toBeGreaterThan(2);
      },
      { timeout: 10000 },
    );
  }, 15000);

  it('renders embedded blob resources as non-navigating header-only file cards', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const toolCall: ToolCall = {
      toolCallId: 'blob-resource-result',
      title: 'Load archive',
      kind: 'other',
      status: 'completed',
      content: [
        {
          type: 'content',
          content: {
            type: 'resource',
            resource: {
              uri: 'urn:uuid:bundle-secret',
              mimeType: 'application/zip',
              blob: 'UEsDBAoAAAAA',
            },
          },
        },
      ],
    };

    render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ToolCallBody toolCall={toolCall} />
      </ArtifactHostActionsProvider>,
    );

    const resourceLabel = screen.getByText('resource');
    const resourceCard = resourceLabel.closest('[data-slot="frame"]');
    const resourceHeader = resourceLabel.closest<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(resourceCard?.querySelector('[data-slot="frame-panel"]')).toBeNull();
    expect(resourceHeader?.tabIndex).toBe(0);
    expect(screen.queryByRole('button', { name: 'resource' })).toBeNull();
    await user.hover(resourceHeader!);
    expect(await screen.findByText('urn:uuid:bundle-secret')).toBeDefined();
    await user.click(resourceHeader!);
    expect(openFile).not.toHaveBeenCalled();
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
    expect(tooltipTrigger?.tabIndex).toBe(0);
  });

  it('keeps a Claude edit receipt outside the structured file diff', () => {
    const path = '/repo/hello.py';
    const receipt =
      'The file /repo/hello.py has been updated successfully. The file state is current.';
    const toolCall: ToolCall = {
      toolCallId: 'claude-edit-receipt',
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      locations: [{ path }],
      content: [
        {
          type: 'diff',
          path,
          oldText: 'print("hello")\n',
          newText: 'print("hello")\n\nhello()\n',
        },
        { type: 'content', content: { type: 'text', text: receipt } },
      ],
    };

    render(<ToolCallBody toolCall={toolCall} />);

    const fileCard = screen.getByText('hello.py').closest('[data-slot="frame"]');
    const receiptNode = screen.getByText(receipt);
    expect(screen.getAllByText('hello.py')).toHaveLength(1);
    expect(fileCard?.contains(receiptNode)).toBe(false);
    expect(receiptNode.closest('[data-slot="frame"]')?.textContent).toContain('Edit');
  });

  it('renders patch-only moves and textless binary deletes', () => {
    const moved: ToolCall = {
      toolCallId: 'move-patch',
      title: 'Move file',
      kind: 'edit',
      status: 'completed',
      content: [
        {
          type: 'diff',
          change: 'move',
          oldPath: '/repo/old.ts',
          path: '/repo/new.ts',
          patch: { format: 'git_patch', text: '@@ -1 +1 @@\n-old\n+new' },
        },
      ],
    };
    const deleted: ToolCall = {
      toolCallId: 'delete-binary',
      title: 'Delete binary',
      kind: 'edit',
      status: 'completed',
      content: [{ type: 'diff', change: 'delete', path: '/repo/logo.bin', isBinary: true }],
    };

    const { rerender } = render(<ToolCallBody toolCall={moved} />);
    expect(screen.getByText('/repo/old.ts → /repo/new.ts')).toBeDefined();
    expect(screen.getByText('old')).toBeDefined();
    expect(screen.getByText('new')).toBeDefined();

    rerender(<ToolCallBody toolCall={deleted} />);
    expect(screen.getByText('logo.bin')).toBeDefined();
  });

  it('keeps a failed mutation explanation visible without presenting it as file content', () => {
    const path = '/repo/hello.py';
    const explanation =
      'The target changed before the edit could be applied. The user modified the file after it was read.';
    const toolCall: ToolCall = {
      toolCallId: 'failed-edit-receipt',
      title: 'Edit',
      kind: 'edit',
      status: 'failed',
      locations: [{ path }],
      content: [
        { type: 'diff', path, oldText: 'before\n', newText: 'after\n' },
        { type: 'content', content: { type: 'text', text: explanation } },
      ],
    };

    render(<ToolCallBody toolCall={toolCall} />);

    const fileCard = screen.getByText('hello.py').closest('[data-slot="frame"]');
    const explanationNode = screen.getByText(explanation);
    expect(explanationNode).toBeDefined();
    expect(fileCard?.contains(explanationNode)).toBe(false);
  });

  it.each([
    [
      'OpenCode content',
      [{ type: 'content' as const, content: { type: 'text' as const, text: 'Updated hello.py' } }],
      undefined,
    ],
    ['Pi raw output', [], { content: [{ type: 'text' as const, text: 'Updated hello.py' }] }],
  ])('keeps a %s mutation receipt outside the file navigation card', (_label, content, rawOutput) => {
    const toolCall: ToolCall = {
      toolCallId: 'mutation-receipt',
      title: 'Edit',
      kind: 'edit',
      status: 'completed',
      locations: [{ path: '/repo/hello.py' }],
      content,
      rawOutput,
    };

    render(<ToolCallBody toolCall={toolCall} />);

    const fileCard = screen.getByText('hello.py').closest('[data-slot="frame"]');
    const receiptNode = screen.getByText('Updated hello.py');
    expect(fileCard?.querySelector('[data-slot="frame-panel"]')).toBeNull();
    expect(fileCard?.contains(receiptNode)).toBe(false);
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

describe('FileArtifactCard', () => {
  it('reuses the file preview header and opens the full path when the host supports it', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const path = '/repo/output/report.pdf';

    render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <FileArtifactCard path={path} />
      </ArtifactHostActionsProvider>,
    );

    const header = screen.getByRole('button', { name: 'report.pdf' });
    const card = header.closest('[data-slot="frame"]');
    expect(card?.className).toContain('max-w-md');
    expect(card?.querySelector('[data-slot="frame-panel"]')).toBeNull();
    await user.hover(header);
    expect(await screen.findByText(path)).toBeDefined();
    await user.click(header);
    expect(openFile).toHaveBeenCalledOnce();
    expect(openFile).toHaveBeenCalledWith(path);
  });

  it('keeps its full-path tooltip keyboard reachable without a host file viewer', async () => {
    const user = userEvent.setup();
    const path = '/repo/output/report.pdf';

    render(<FileArtifactCard path={path} />);

    const label = screen.getByText('report.pdf');
    const header = label.closest<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(header?.tabIndex).toBe(0);
    header?.focus();
    expect(await screen.findByText(path)).toBeDefined();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'report.pdf' })).toBeNull();
  });
});

describe('ToolCallItem', () => {
  it('uses Sparkles for a thinking tool', () => {
    const toolCall: ToolCall = {
      toolCallId: 'thinking-tool',
      title: 'Think',
      kind: 'think',
      status: 'completed',
      content: [],
    };

    const { container } = render(<ToolCallItem toolCall={toolCall} />);

    expect(
      container
        .querySelector('[data-slot="chat-disclosure-icon"]')
        ?.querySelector('.lucide-sparkles'),
    ).not.toBeNull();
  });

  it('omits the disclosure without leaving a leading placeholder when there is no detail', () => {
    const toolCall: ToolCall = {
      toolCallId: 'empty-tool',
      title: 'No details',
      kind: 'other',
      status: 'completed',
      content: [],
    };

    const { container } = render(<ToolCallItem toolCall={toolCall} />);

    const header = screen.getByText('No details').closest('.group');
    expect(header?.querySelector('.lucide-chevron-right')).toBeNull();
    expect(
      container
        .querySelector('[data-slot="chat-disclosure-icon"]')
        ?.querySelector('.lucide-wrench'),
    ).not.toBeNull();
  });

  it('ends with disclosure and names failure without an action-kind badge', () => {
    const toolCall: ToolCall = {
      toolCallId: 'bash-failed',
      title: 'Bash',
      kind: 'execute',
      status: 'failed',
      rawInput: { command: 'false' },
      content: [],
    };

    render(<ToolCallItem toolCall={toolCall} />);

    const header = screen.getByRole('button', { name: RE_BASH });
    const title = screen.getByText('Bash');
    const summary = screen.getByText('· false');
    expect(header.lastElementChild?.classList.contains('lucide-chevron-right')).toBe(true);
    expect(title.className).toContain('shrink-0');
    expect(summary.className).toContain('shrink');
    expect(summary.className).toContain('truncate');
    expect(header.querySelector('[data-slot="chat-disclosure-icon"]')).not.toBeNull();
    expect(header.querySelector('svg.lucide-circle-x')).not.toBeNull();
    expect(header.textContent).toContain('failed');
    expect(header.textContent).not.toContain('kindExecute');
  });

  it('marks a call awaiting the user answer with the question glyph, not a spinner', () => {
    const toolCall: ToolCall = {
      toolCallId: 'question-1',
      title: 'Request user input',
      kind: 'other',
      status: 'pending',
      content: [],
    };

    const { container } = render(<ToolCallItem awaitingAnswer toolCall={toolCall} />);

    expect(container.querySelector('svg.lucide-message-circle-question-mark')).not.toBeNull();
    expect(container.querySelector('svg.lucide-loader-circle')).toBeNull();
    expect(container.querySelector('.bg-clip-text')).not.toBeNull();
  });

  it('shimmers running and user-blocked titles but not declined ones', () => {
    const running: ToolCall = {
      toolCallId: 'running-1',
      title: 'Running tests',
      kind: 'execute',
      status: 'in_progress',
      content: [],
    };

    const { container, rerender } = render(<ToolCallItem toolCall={running} />);
    // The kind glyph stays put while running — the shimmering title is the activity signal.
    expect(container.querySelector('svg.lucide-loader-circle')).toBeNull();
    expect(container.querySelector('svg.lucide-terminal')?.getAttribute('class')).toContain(
      'text-foreground',
    );
    expect(container.querySelector('.bg-clip-text')?.textContent).toBe('Running tests');

    rerender(<ToolCallItem awaitingApproval toolCall={{ ...running, status: 'pending' }} />);
    expect(container.querySelector('svg.lucide-shield')).not.toBeNull();
    expect(container.querySelector('.bg-clip-text')).not.toBeNull();

    rerender(<ToolCallItem declined toolCall={{ ...running, status: 'pending' }} />);
    expect(container.querySelector('svg.lucide-ban')).not.toBeNull();
    expect(container.querySelector('.bg-clip-text')).toBeNull();
  });

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
          path: 'packages/presentation/ui/src/chat/target.ts',
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
    expect(headerText).not.toContain('packages/presentation/ui/src/chat');
  });

  it('opens an edited file from the shared diff header', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const path = 'packages/presentation/ui/src/chat/target.ts';
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
    const source = 'packages/presentation/ui/src/chat/target.ts';
    const destination = 'packages/presentation/ui/src/chat/moved.ts';
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
    expect(container.textContent).not.toContain('packages/presentation/ui/src/chat');
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
    const editedPath = 'packages/presentation/ui/edited.ts';
    const deletedPath = 'packages/presentation/ui/gone.ts';
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
    const path = 'packages/presentation/ui/src/chat/gone.ts';
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
    awaitingAnswer: new Set<string>(),
    questionsByToolCall: new Map<string, QuestionConversationItem>(),
    childrenByParent: new Map(),
    declined: new Set<string>(),
    toolCall: taskToolCall,
  };

  it('keeps the subagent top-level summary compact when a child action fails', () => {
    render(
      <SubagentCard
        {...sharedProps}
        items={[
          {
            id: 'child-failed',
            kind: 'tool',
            turnId: null,
            toolCall: {
              toolCallId: 'child-failed',
              title: 'Bash',
              kind: 'execute',
              status: 'failed',
              content: [],
            },
          },
        ]}
      />,
    );

    const header = screen.getByRole('button', { name: RE_SUBAGENT_LABEL });
    expect(header.lastElementChild?.classList.contains('lucide-chevron-right')).toBe(true);
    expect(header.textContent).toContain('failed');
    expect(header.textContent).not.toContain('steps');
  });

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

    expect(screen.getAllByText('Final review report')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'thought' }).textContent).toBe('thought');
  });

  it('keeps streaming subagent reasoning open and shows only its public summary in the header', () => {
    render(
      <SubagentTranscript
        {...sharedProps}
        items={[
          {
            id: 'reasoning-streaming',
            kind: 'reasoning',
            turnId: null,
            isStreaming: true,
            summary: 'Reviewing public results',
            blocks: [{ type: 'text', text: 'api_key=private' }],
          },
        ]}
      />,
    );

    const header = screen.getByRole('button', { name: RE_THINKING_PUBLIC_SUMMARY });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(header.textContent).not.toContain('api_key');
  });
});

describe('QuestionCallItem', () => {
  const questionToolCall: ToolCall = {
    toolCallId: 'question-1',
    title: 'AskUserQuestion',
    kind: 'other',
    status: 'pending',
    rawOutput: 'The user doesn’t want to proceed with this tool use.',
    content: [],
  };
  const questionItem: QuestionConversationItem = {
    id: 'question-item-1',
    kind: 'question',
    turnId: 'turn-1',
    requestId: 'request-1',
    toolCall: { toolCallId: 'question-1' },
    questions: [
      {
        questionId: 'scope',
        prompt: 'How broad should the change be?',
        header: 'Scope',
        multiSelect: false,
        options: [
          { optionId: 'narrow', label: 'Narrow fix' },
          { optionId: 'broad', label: 'Broad refactor' },
        ],
      },
    ],
    responding: false,
  };

  it('presents a pending ask as a shimmering question row without the raw payload', () => {
    const { container } = render(
      <QuestionCallItem awaitingAnswer question={questionItem} toolCall={questionToolCall} />,
    );

    expect(container.querySelector('svg.lucide-message-circle-question-mark')).not.toBeNull();
    expect(container.querySelector('svg.lucide-loader-circle')).toBeNull();
    expect(container.querySelector('svg.lucide-wrench')).toBeNull();
    expect(container.querySelector('.bg-clip-text')?.textContent).toBe('callTitle');
    expect(screen.getByText('· How broad should the change be?')).toBeDefined();
    expect(container.textContent).not.toContain('AskUserQuestion');
    expect(container.textContent).not.toContain('want to proceed');
  });

  it('records the chosen answer once resolved', async () => {
    const user = userEvent.setup();
    render(
      <QuestionCallItem
        question={{
          ...questionItem,
          resolution: {
            outcome: {
              outcome: 'answered',
              answers: [{ questionId: 'scope', selectedOptionIds: ['narrow'] }],
            },
            source: 'user',
          },
        }}
        toolCall={{ ...questionToolCall, status: 'completed' }}
      />,
    );

    const header = screen.getByRole('button', { name: RE_QUESTION_CALL_TITLE });
    expect(header.querySelector('svg.lucide-message-circle-question-mark')).not.toBeNull();
    expect(header.querySelector('.bg-clip-text')).toBeNull();
    await user.click(header);
    expect(screen.getByText('How broad should the change be?')).toBeDefined();
    expect(screen.getByText('Narrow fix')).toBeDefined();
  });

  it('labels a dismissed ask instead of showing a raw failure', () => {
    const { container } = render(
      <QuestionCallItem
        question={{
          ...questionItem,
          resolution: { outcome: { outcome: 'cancelled' }, source: 'user' },
        }}
        toolCall={{ ...questionToolCall, status: 'failed' }}
      />,
    );

    expect(screen.getByText('dismissed')).toBeDefined();
    expect(container.textContent).not.toContain('want to proceed');
  });
});
