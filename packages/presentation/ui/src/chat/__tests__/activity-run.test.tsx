// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityRunEntry } from '../activity-run';
import { ActivityRun } from '../activity-run';
import { ArtifactHostActionsProvider } from '../artifacts/context';
import type { ConversationItem } from '../types';

function translateKey(key: string, values?: Record<string, unknown>): string {
  if (key === 'ariaLabel') return `Activity details: ${String(values?.label)}`;
  const labels: Record<string, string> = {
    'running.edit': 'Editing',
    'running.execute': 'Running command',
    'running.reasoning': 'Thinking',
    'settled.command': 'Ran commands',
    'settled.explore': 'Explored',
    'settled.files': 'Edited files',
    'settled.integration': 'Used integrations',
    'settled.thinking': 'Thought',
    failed: 'Some actions failed',
  };
  return labels[key] ?? key;
}

function translationsMock(): typeof translateKey {
  return translateKey;
}

vi.mock('use-intl', () => ({
  useTranslations: translationsMock,
}));

afterEach(cleanup);

const WINDOWS_SECOND_PATH = String.raw`C:\repo\packages\second.ts`;
const RE_ACTIVITY_DETAILS = /^Activity details:/;
const RE_COUNT_ONE = /\b1\b/u;
const RE_DECLINED_COMMAND = /Declined command.*declined/;
const RE_EDIT_FIRST = /^Edit· first\.ts/;
const RE_FAILURE = /Some actions failed/u;
const RE_FAILURE_GLOBAL = /Some actions failed/gu;
const RE_GUARDED_COMMAND = /Guarded command.*reviewRequired/;
const RE_NEW_COMMAND = /^New command/;
const RE_PANEL_PADDING = /\bpl-/u;

function fileTool(
  id: string,
  kind: Extract<ToolCall['kind'], 'edit' | 'delete'>,
  path: string,
): Extract<ActivityRunEntry['items'][number], { kind: 'tool' }> {
  return {
    id,
    kind: 'tool',
    turnId: 'turn-1',
    toolCall: {
      toolCallId: id,
      title: kind === 'edit' ? 'Edit' : 'Delete',
      kind,
      status: 'completed',
      rawInput: { file_path: path },
      content: [],
    },
  };
}

function executeTool(
  id: string,
  title: string,
  command: string,
  status: ToolCall['status'] = 'completed',
): Extract<ActivityRunEntry['items'][number], { kind: 'tool' }> {
  return {
    id,
    kind: 'tool',
    turnId: 'turn-1',
    toolCall: {
      toolCallId: id,
      title,
      kind: 'execute',
      status,
      rawInput: { command },
      content: [],
    },
  };
}

function simpleTool(
  id: string,
  kind: Extract<ToolCall['kind'], 'read' | 'search' | 'fetch' | 'think' | 'other'>,
  title: string,
  rawInput?: unknown,
): Extract<ActivityRunEntry['items'][number], { kind: 'tool' }> {
  return {
    id,
    kind: 'tool',
    turnId: 'turn-1',
    toolCall: {
      toolCallId: id,
      title,
      kind,
      status: 'completed',
      rawInput,
      content: [],
    },
  };
}

function reasoningItem(
  id: string,
  text: string,
  isStreaming = false,
): Extract<ConversationItem, { kind: 'reasoning' }> {
  return {
    id,
    kind: 'reasoning',
    turnId: 'turn-1',
    blocks: [{ type: 'text', text }],
    isStreaming,
  };
}

function activityRun(items: ActivityRunEntry['items']): ActivityRunEntry {
  return { type: 'run', id: 'run-first', items };
}

const EMPTY_IDS = new Set<string>();

describe('ActivityRun', () => {
  it('starts collapsed and toggles by keyboard with a leading disclosure', async () => {
    const user = userEvent.setup();
    const run = activityRun([
      reasoningItem('thought-1', 'Inspect the renderer'),
      executeTool('command-1', 'Check types', 'pnpm typecheck'),
    ]);

    const { container } = render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile: vi.fn() }}>
        <ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />
      </ArtifactHostActionsProvider>,
    );

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(header.querySelector('svg')?.classList.contains('lucide-chevron-right')).toBe(true);
    expect(header.textContent).not.toContain('2');
    expect(container.querySelector('[data-slot="collapsible-panel"]')).toBeNull();

    header.focus();
    await user.keyboard('{Enter}');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('summarizes streaming reasoning and pending tools without exposing sensitive detail', () => {
    const streamingRun = activityRun([
      executeTool('command-1', 'Finished command', 'git status'),
      reasoningItem('thought-1', 'Inspect api_key=private', true),
    ]);
    const props = { awaitingApproval: EMPTY_IDS, declined: EMPTY_IDS };
    const { rerender } = render(<ActivityRun {...props} run={streamingRun} />);

    let header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toBe('Thinking');
    expect(header.getAttribute('aria-label')).not.toContain('private');
    expect(header.querySelector('svg.lucide-loader-circle')).not.toBeNull();

    const pendingEdit = fileTool('edit-1', 'edit', '/repo/first.ts');
    pendingEdit.toolCall.status = 'pending';
    rerender(
      <ActivityRun
        {...props}
        run={activityRun([reasoningItem('thought-1', 'Done'), pendingEdit])}
      />,
    );

    header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toBe('Editing · first.ts');
    expect(header.querySelector('svg.lucide-loader-circle')).not.toBeNull();
  });

  it('keeps a concise destructive failure clause beside a running action', () => {
    const failed = fileTool('edit-failed', 'edit', '/repo/first.ts');
    failed.toolCall.status = 'failed';
    const run = activityRun([
      failed,
      executeTool('command-running', 'Guarded command', 'echo secret=private', 'in_progress'),
    ]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toBe('Running command · Some actions failed');
    expect(header.getAttribute('aria-label')).not.toContain('private');
    expect(within(header).getByText(RE_FAILURE).className).toContain('text-destructive-foreground');
    expect(header.querySelector('svg.lucide-loader-circle')).not.toBeNull();
  });

  it('renders reasoning and tools in their original order without a styled group panel', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const run = activityRun([
      reasoningItem('thought-1', 'Reasoning first'),
      executeTool('command-1', 'Command second', 'pnpm test'),
      fileTool('edit-1', 'edit', '/repo/packages/first.ts'),
      fileTool('delete-1', 'delete', WINDOWS_SECOND_PATH),
    ]);

    const { container } = render(
      <ArtifactHostActionsProvider actions={{ referenceToComposer: vi.fn(), openFile }}>
        <ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />
      </ArtifactHostActionsProvider>,
    );

    const runHeader = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    await user.click(runHeader);
    expect(runHeader.getAttribute('aria-expanded')).toBe('true');

    const panel = container.querySelector('[data-slot="collapsible-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.className).not.toContain('bg-secondary');
    expect(panel?.className).not.toContain('rounded');
    expect(panel?.className).not.toMatch(RE_PANEL_PADDING);

    const leafHeaders = within(panel as HTMLElement).getAllByRole('button');
    expect(leafHeaders.map((header) => header.textContent)).toEqual([
      'thoughtReasoning first',
      'Command second· pnpm test',
      'Edit· first.ts',
      'Delete· second.ts',
    ]);
    expect(
      [runHeader, ...leafHeaders].every((header) =>
        header.querySelector('svg')?.classList.contains('lucide-chevron-right'),
      ),
    ).toBe(true);
    expect(panel?.textContent).not.toContain('/repo');
    expect(panel?.textContent).not.toContain(String.raw`C:\repo`);

    await user.click(screen.getByRole('button', { name: RE_EDIT_FIRST }));
    await user.click(screen.getByRole('button', { name: 'first.ts' }));
    expect(openFile).toHaveBeenCalledWith('/repo/packages/first.ts');
  });

  it('keeps the user-selected open state when the same run receives another item', async () => {
    const user = userEvent.setup();
    const initialRun = activityRun([
      executeTool('command-1', 'First command', 'pnpm lint'),
      fileTool('edit-1', 'edit', '/repo/first.ts'),
    ]);
    const props = {
      awaitingApproval: EMPTY_IDS,
      declined: EMPTY_IDS,
      TerminalBlockComponent: undefined,
    };
    const { rerender } = render(<ActivityRun {...props} run={initialRun} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    await user.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');

    rerender(
      <ActivityRun
        {...props}
        run={{
          ...initialRun,
          items: [...initialRun.items, executeTool('command-2', 'New command', 'pnpm test')],
        }}
      />,
    );

    expect(
      screen.getByRole('button', { name: RE_ACTIVITY_DETAILS }).getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: RE_NEW_COMMAND })).toBeDefined();
  });

  it('forwards approval and rejection state to the original tool rows', async () => {
    const user = userEvent.setup();
    const run = activityRun([
      executeTool('declined-1', 'Declined command', 'git status'),
      executeTool('approval-1', 'Guarded command', 'pnpm test', 'pending'),
    ]);

    render(
      <ActivityRun
        awaitingApproval={new Set(['approval-1'])}
        declined={new Set(['declined-1'])}
        run={run}
      />,
    );
    await user.click(screen.getByRole('button', { name: RE_ACTIVITY_DETAILS }));

    expect(screen.getByRole('button', { name: RE_DECLINED_COMMAND })).toBeDefined();
    expect(screen.getByRole('button', { name: RE_GUARDED_COMMAND })).toBeDefined();
  });

  it('announces failure once without exposing a failure count', () => {
    const failed = fileTool('edit-failed', 'edit', '/repo/first.ts');
    failed.toolCall.status = 'failed';
    const run = activityRun([failed, executeTool('command-1', 'Check status', 'git status')]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent.match(RE_FAILURE_GLOBAL)).toHaveLength(1);
    expect(header.textContent).not.toMatch(RE_COUNT_ONE);
  });

  it('renders each settled semantic category once and keeps failure independently styled', () => {
    const failedEdit = fileTool('edit-failed', 'edit', '/repo/first.ts');
    failedEdit.toolCall.status = 'failed';
    const run = activityRun([
      failedEdit,
      fileTool('delete-1', 'delete', '/repo/second.ts'),
      simpleTool('integration-1', 'other', 'Linear'),
      executeTool('command-1', 'Check status', 'git status'),
      simpleTool('read-1', 'read', 'Read', { file_path: '/repo/README.md' }),
      reasoningItem('thought-1', 'Reviewed the results'),
    ]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    for (const label of [
      'Some actions failed',
      'Edited files',
      'Used integrations',
      'Ran commands',
      'Explored',
      'Thought',
    ]) {
      expect(header.textContent.split(label)).toHaveLength(2);
    }
    expect(within(header).getByText(RE_FAILURE).className).toContain('text-destructive-foreground');
    expect(header.querySelector('svg.lucide-circle-x')).not.toBeNull();
  });
});
