// @vitest-environment jsdom

import type { ToolCall } from '@linkcode/schema';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFixedArray } from 'foxts/create-fixed-array';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityRunEntry } from '../activity-run';
import { ActivityRun } from '../activity-run';
import { ArtifactHostActionsProvider } from '../artifacts/context';
import type { ConversationItem } from '../types';

function translateKey(key: string, values?: Record<string, unknown>): string {
  if (key === 'ariaLabel') return `Activity details: ${String(values?.label)}`;
  const labels: Record<string, string> = {
    'running.edit': 'Editing a file',
    'running.execute': 'Running a command',
    'running.reasoning': 'Thinking',
    'settledMany.command': 'Ran commands',
    'settledMany.explore': 'Explored repeatedly',
    'settledMany.files': 'Changed files',
    'settledMany.integration': 'Used integrations',
    'settled.thinking': 'Thought',
    thought: 'Thought',
    failedMany: 'Some actions failed',
  };
  const count = Number(values?.count);
  if (key === 'failed') return count === 1 ? 'An action failed' : `${count} actions failed`;
  if (key === 'settled.command') return count === 1 ? 'Ran a command' : `Ran ${count} commands`;
  if (key === 'settled.explore') return count === 1 ? 'Explored once' : `Explored ${count} times`;
  if (key === 'settled.files') {
    return count === 1 ? 'Made a file change' : `Made ${count} file changes`;
  }
  if (key === 'settled.integration') {
    return count === 1 ? 'Used an integration once' : `Used an integration ${count} times`;
  }
  if (key === 'thoughtDuration') return `Thought for ${String(values?.seconds)} seconds`;
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
const RE_DECLINED_COMMAND = /Declined command.*declined/;
const RE_EDIT_FIRST = /^Edit· first\.ts/;
const RE_FAILURE = /An action failed/u;
const RE_FAILURE_GLOBAL = /3 actions failed/gu;
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
  overrides: Partial<Extract<ConversationItem, { kind: 'reasoning' }>> = {},
): Extract<ConversationItem, { kind: 'reasoning' }> {
  return {
    id,
    kind: 'reasoning',
    turnId: 'turn-1',
    blocks: [{ type: 'text', text }],
    isStreaming,
    ...overrides,
  };
}

function activityRun(items: ActivityRunEntry['items']): ActivityRunEntry {
  return { type: 'run', id: 'run-first', items };
}

const EMPTY_IDS = new Set<string>();

describe('ActivityRun', () => {
  it('starts collapsed and toggles by keyboard with a trailing disclosure', async () => {
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
    expect(header.lastElementChild?.classList.contains('lucide-chevron-right')).toBe(true);
    expect(header.textContent).not.toContain('Inspect the renderer');
    expect(header.textContent).not.toContain('pnpm typecheck');
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
      reasoningItem('thought-1', 'Inspect api_key=private', true, {
        summary: '  Checking\npublic behavior  ',
      }),
    ]);
    const props = { awaitingApproval: EMPTY_IDS, declined: EMPTY_IDS };
    const { rerender } = render(<ActivityRun {...props} run={streamingRun} />);

    let header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toBe('Thinking · Checking public behavior');
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
    expect(header.textContent).toBe('Editing a file');
    expect(header.getAttribute('aria-label')).not.toContain('first.ts');
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
    expect(header.textContent).toBe('Running a command · An action failed');
    expect(header.getAttribute('aria-label')).not.toContain('private');
    expect(within(header).getByText(RE_FAILURE).className).toContain('text-destructive-foreground');
    const icon = header.querySelector('svg.lucide-terminal');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('class')).toContain('text-destructive-foreground');
    expect(header.querySelector('svg.lucide-circle-x')).toBeNull();
    expect(header.querySelector('svg.lucide-loader-circle')).toBeNull();
  });

  it('places an explicit active thinking summary before a failure notice', () => {
    const failed = fileTool('edit-failed', 'edit', '/repo/private.ts');
    failed.toolCall.status = 'failed';
    const run = activityRun([
      failed,
      reasoningItem('thought-running', 'token=private', true, { summary: 'Reviewing results' }),
    ]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toBe('Thinking · Reviewing results · An action failed');
    expect(header.textContent).not.toContain('private');
    const failure = within(header).getByText(RE_FAILURE);
    expect(failure.className).toContain('shrink-0');
    expect(failure.previousElementSibling?.lastElementChild?.className).toContain('shrink');
    const icon = header.querySelector('svg.lucide-sparkles');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('class')).toContain('text-destructive-foreground');
  });

  it('renders reasoning and tools in their original order without a styled group panel', async () => {
    const user = userEvent.setup();
    const openFile = vi.fn();
    const run = activityRun([
      reasoningItem('thought-1', 'Reasoning first', false, {
        startedAt: 1000,
        endedAt: 6300,
      }),
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
      'Thought for 5 seconds',
      'Command second· pnpm test',
      'Edit· first.ts',
      'Delete· second.ts',
    ]);
    expect(
      [runHeader, ...leafHeaders].every((header) =>
        header.lastElementChild?.classList.contains('lucide-chevron-right'),
      ),
    ).toBe(true);
    await user.click(leafHeaders[0]);
    expect(leafHeaders[0].children).toHaveLength(3);
    expect(panel?.textContent).not.toContain('/repo');
    expect(panel?.textContent).not.toContain(String.raw`C:\repo`);
    expect(leafHeaders[0].textContent).not.toContain('Reasoning first');

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

  it('announces an exact failure count once', () => {
    const failures = ['first.ts', 'second.ts', 'third.ts'].map((path, index) => {
      const failed = fileTool(`edit-failed-${index}`, 'edit', `/repo/${path}`);
      failed.toolCall.status = 'failed';
      return failed;
    });
    const run = activityRun([...failures, executeTool('command-1', 'Check status', 'git status')]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent.match(RE_FAILURE_GLOBAL)).toHaveLength(1);
  });

  it('renders each settled semantic category once and keeps failure independently styled', () => {
    const failedEdit = fileTool('edit-failed', 'edit', '/repo/first.ts');
    failedEdit.toolCall.status = 'failed';
    const run = activityRun([
      reasoningItem('thought-1', 'Reviewed the results'),
      simpleTool('read-1', 'read', 'Read', { file_path: '/repo/README.md' }),
      fileTool('delete-1', 'delete', '/repo/second.ts'),
      executeTool('command-1', 'Check status', 'git status'),
      simpleTool('integration-1', 'other', 'Linear'),
      failedEdit,
    ]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    const expected =
      'An action failed · Used an integration once · Ran a command · Made 2 file changes · Explored once';
    expect(header.textContent).toBe(expected);
    for (const label of [
      'An action failed',
      'Used an integration once',
      'Ran a command',
      'Made 2 file changes',
      'Explored once',
    ]) {
      expect(header.textContent.split(label)).toHaveLength(2);
    }
    expect(within(header).getByText(RE_FAILURE).className).toContain('text-destructive-foreground');
    const icon = header.querySelector('svg.lucide-wrench');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('class')).toContain('text-destructive-foreground');
    expect(header.querySelector('svg.lucide-circle-x')).toBeNull();
    for (const detail of [
      'first.ts',
      'second.ts',
      'Linear',
      'git status',
      'README.md',
      'Reviewed the results',
    ]) {
      expect(header.textContent).not.toContain(detail);
      expect(header.getAttribute('aria-label')).not.toContain(detail);
    }
  });

  it('uses an uncounted Thought fallback for a thinking-only run', () => {
    const run = activityRun([
      reasoningItem('thought-1', 'Private first thought'),
      simpleTool('think-1', 'think', 'Private second thought'),
    ]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toBe('Thought');
    expect(header.textContent).not.toContain('2');
    expect(header.textContent).not.toContain('Private');
    expect(header.querySelector('svg.lucide-sparkles')).not.toBeNull();
  });

  it('keeps the thinking icon when a thinking-only run fails', () => {
    const failedThink = simpleTool('think-failed', 'think', 'Private failed thought');
    failedThink.toolCall.status = 'failed';
    const run = activityRun([reasoningItem('thought-1', 'Private first thought'), failedThink]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    const icon = header.querySelector('svg.lucide-sparkles');
    expect(header.textContent).toBe('An action failed');
    expect(icon?.getAttribute('class')).toContain('text-destructive-foreground');
    expect(header.querySelector('svg.lucide-wrench')).toBeNull();
    expect(header.querySelector('svg.lucide-circle-x')).toBeNull();
  });

  it.each([
    [1, 'Ran a command'],
    [2, 'Ran 2 commands'],
    [10, 'Ran 10 commands'],
    [11, 'Ran commands'],
  ] as const)('shows the bounded command count for %i actions', (count, expected) => {
    const commands = createFixedArray(count).map((index) =>
      executeTool(`command-${index}`, `Private title ${index}`, `secret-command-${index}`),
    );
    const run = activityRun([...commands, reasoningItem('thought-1', 'Private reasoning')]);

    render(<ActivityRun awaitingApproval={EMPTY_IDS} declined={EMPTY_IDS} run={run} />);

    const header = screen.getByRole('button', { name: RE_ACTIVITY_DETAILS });
    expect(header.textContent).toContain(expected);
    expect(header.textContent).not.toContain('Private');
    expect(header.textContent).not.toContain('secret-command');
    if (count > 10) expect(header.textContent).not.toContain(String(count));
  });
});
