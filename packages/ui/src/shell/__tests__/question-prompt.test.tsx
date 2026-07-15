// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PermissionConversationItem,
  QuestionConversationItem,
} from '../../chat/conversation-prompts';
import type { ConversationViewModel } from '../../chat/types';
import { ConversationPromptDock } from '../conversation-prompt-dock';
import { QuestionPrompt } from '../question-prompt';

function translateKey(namespace: string, key: string, values?: Record<string, unknown>): string {
  if (key === 'progress') return `${String(values?.current)} of ${String(values?.total)}`;
  if (key === 'queued') return `${String(values?.count)} queued`;
  if (namespace === 'workbench.question' && key === 'previous') return 'previous question';
  if (namespace === 'workbench.question' && key === 'next') return 'next question';
  if (namespace === 'workbench.prompt' && key === 'previous') return 'previous prompt';
  if (namespace === 'workbench.prompt' && key === 'next') return 'next prompt';
  if (namespace === 'workbench.permission' && key === 'question') {
    return `Allow ${String(values?.action)}?`;
  }
  return key;
}

function translationsMock(
  namespace: string,
): (key: string, values?: Record<string, unknown>) => string {
  return (key, values) => translateKey(namespace, key, values);
}

vi.mock('use-intl', () => ({
  useTranslations: translationsMock,
}));

const ITEM: QuestionConversationItem = {
  kind: 'question',
  id: 'request-1',
  turnId: 'turn-1',
  requestId: 'request-1',
  toolCall: { toolCallId: 'tool-1', title: 'AskUserQuestion' },
  questions: [
    {
      questionId: 'q1',
      prompt: 'Pick features',
      header: 'Features',
      multiSelect: true,
      options: [
        { optionId: 'cache', label: 'Cache' },
        { optionId: 'retry', label: 'Retry' },
      ],
    },
    {
      questionId: 'q2',
      prompt: 'Pick a runtime',
      header: 'Runtime',
      multiSelect: false,
      options: [
        { optionId: 'node', label: 'Node' },
        { optionId: 'bun', label: 'Bun' },
      ],
    },
    {
      questionId: 'q3',
      prompt: 'Pick a release channel',
      header: 'Release',
      multiSelect: false,
      options: [
        { optionId: 'stable', label: 'Stable' },
        { optionId: 'canary', label: 'Canary' },
      ],
    },
  ],
};

const ALLOW_OPTION = { optionId: 'allow', name: 'Allow', kind: 'allow_once' as const };
const PERMISSION_ITEM: PermissionConversationItem = {
  kind: 'approval',
  id: 'permission-1',
  turnId: 'turn-1',
  requestId: 'permission-1',
  toolCall: { toolCallId: 'command-1', title: 'Run command' },
  options: [ALLOW_OPTION, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
};

function permission(requestId: string, title: string): PermissionConversationItem {
  return {
    ...PERMISSION_ITEM,
    id: requestId,
    requestId,
    toolCall: { toolCallId: `command-${requestId}`, title },
  };
}

function conversation(
  items: ConversationViewModel['items'],
  overrides: Partial<ConversationViewModel> = {},
): ConversationViewModel {
  return {
    items,
    status: 'running',
    usage: null,
    currentModeId: null,
    approvalPolicy: null,
    currentModel: null,
    currentEffort: null,
    availableCommands: null,
    capabilities: null,
    stopReason: null,
    pendingPermissionIds: [],
    pendingQuestionIds: [],
    ...overrides,
  };
}

const CACHE_CHOICE_NAME = /Cache$/;
const BUN_CHOICE_NAME = /Bun$/;
const NODE_CHOICE_NAME = /Node$/;
const STABLE_CHOICE_NAME = /Stable$/;
const ALLOW_CHOICE_NAME = /Allow$/;
const PICK_RUNTIME_GROUP_NAME = /^Pick a runtime/;
const FOCUSED_CHOICE_NAME = /Focused/;
const PERMISSION_ASKS_CHOICE_NAME = /Permission asks/;
const BRIEF_CHOICE_NAME = /Brief/;
const SUMMARY_CHOICE_NAME = /Summary$/;

afterEach(cleanup);

describe('QuestionPrompt', () => {
  it('pages bidirectionally, preserves edits, and submits one ordered batch', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);

    expect(screen.getByText('1 of 3')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: 'previous question' }).getAttribute('aria-disabled'),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'submit' }).hasAttribute('disabled')).toBe(true);
    const cache = screen.getByRole('button', { name: CACHE_CHOICE_NAME });
    await user.click(cache);
    await user.click(screen.getByRole('link', { name: 'next question' }));

    expect(screen.getByText('2 of 3')).toBeDefined();
    expect(onRespond).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: NODE_CHOICE_NAME }));
    expect(
      screen.getByRole('group', { name: PICK_RUNTIME_GROUP_NAME }).contains(document.activeElement),
    ).toBe(true);
    await user.click(screen.getByRole('link', { name: 'previous question' }));
    expect(screen.getByText('1 of 3')).toBeDefined();
    expect(
      screen.getByRole('button', { name: CACHE_CHOICE_NAME }).getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(screen.getByRole('link', { name: 'next question' }));

    await user.click(screen.getByRole('button', { name: NODE_CHOICE_NAME }));

    expect(screen.getByText('3 of 3')).toBeDefined();
    expect(onRespond).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: STABLE_CHOICE_NAME }));
    await user.click(screen.getByRole('link', { name: 'previous question' }));
    expect(
      screen.getByRole('button', { name: NODE_CHOICE_NAME }).getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: BUN_CHOICE_NAME }));

    await user.click(screen.getByRole('button', { name: STABLE_CHOICE_NAME }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'submit' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond).toHaveBeenCalledWith('request-1', {
      outcome: 'answered',
      answers: [
        { questionId: 'q1', selectedOptionIds: ['cache'], customText: undefined },
        { questionId: 'q2', selectedOptionIds: ['bun'], customText: undefined },
        { questionId: 'q3', selectedOptionIds: ['stable'], customText: undefined },
      ],
    });
  });

  it('cancels once after every question is skipped', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);

    await user.click(screen.getByRole('button', { name: 'skip' }));
    await user.click(screen.getByRole('button', { name: 'skip' }));
    expect(onRespond).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'skip' }));
    expect(onRespond).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond).toHaveBeenCalledWith('request-1', { outcome: 'cancelled' });
  });
});

describe('ConversationPromptDock', () => {
  it('shows complete custom-tool arguments on the approval surface', () => {
    const rawInput = {
      issueId: 'CODE-173',
      options: { includeComments: true, labels: ['frontend', 'review'] },
    };
    const customPermission: PermissionConversationItem = {
      ...PERMISSION_ITEM,
      toolCall: {
        toolCallId: 'mcp-approval-1',
        title: 'linear.update_issue',
        kind: 'other',
        rawInput,
      },
    };
    const customConversation = conversation([customPermission], {
      pendingPermissionIds: [customPermission.requestId],
    });

    render(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={customConversation}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={vi.fn()}
        onRespondQuestion={vi.fn()}
      />,
    );

    const argumentsValue = screen.getByText('arguments').nextElementSibling;
    expect(argumentsValue?.textContent).toBe(JSON.stringify(rawInput, null, 2));
    expect(argumentsValue?.classList.contains('truncate')).toBe(false);
    expect(argumentsValue?.classList.contains('whitespace-pre-wrap')).toBe(true);
  });

  it('exercises the frontend-only batch API stub without calling the backend', async () => {
    const user = userEvent.setup();
    const onRespondQuestion = vi.fn();
    const showcase = conversation([], {
      currentModeId: 'mock-showcase',
    });

    render(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={showcase}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={vi.fn()}
        onRespondQuestion={onRespondQuestion}
      />,
    );

    expect(screen.getByText('1 of 3')).toBeDefined();
    expect(screen.getByText('2 queued')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: FOCUSED_CHOICE_NAME }));
    expect(screen.getByText('2 of 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'skip' }));
    expect(screen.getByText('3 of 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: SUMMARY_CHOICE_NAME }));
    expect(screen.getByText('3 of 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(screen.queryByText('3 of 3')).toBeNull();
    expect(screen.getByText('Pick the mock summary style')).toBeDefined();
    expect(screen.getByText('1 of 2')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);
    await user.click(screen.getByRole('link', { name: 'next prompt' }));
    await user.click(screen.getByRole('button', { name: PERMISSION_ASKS_CHOICE_NAME }));
    expect(
      screen
        .getByRole('button', { name: PERMISSION_ASKS_CHOICE_NAME })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(screen.getByRole('link', { name: 'previous prompt' }));
    expect(screen.getByText('Pick the mock summary style')).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'next prompt' }));
    expect(
      screen
        .getByRole('button', { name: PERMISSION_ASKS_CHOICE_NAME })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'submit' }));
    expect(screen.getByText('Pick the mock summary style')).toBeDefined();
    await user.click(screen.getByRole('button', { name: BRIEF_CHOICE_NAME }));

    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(onRespondQuestion).not.toHaveBeenCalled();
  });

  it('keeps a question group behind the leading standalone prompt', async () => {
    const user = userEvent.setup();
    const onRespondPermission = vi.fn();
    const onRespondQuestion = vi.fn();
    const permissionThenQuestion = conversation([PERMISSION_ITEM, ITEM], {
      pendingPermissionIds: ['permission-1'],
      pendingQuestionIds: ['request-1'],
    });

    const { rerender } = render(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={permissionThenQuestion}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />,
    );

    expect(screen.getByRole('button', { name: ALLOW_CHOICE_NAME })).toBeDefined();
    expect(screen.queryByRole('button', { name: CACHE_CHOICE_NAME })).toBeNull();
    expect(screen.getByText('1 queued')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: ALLOW_CHOICE_NAME }));

    expect(onRespondPermission).toHaveBeenCalledOnce();
    expect(onRespondQuestion).not.toHaveBeenCalled();

    rerender(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={permissionThenQuestion}
        permissionDecisions={
          new Map([['permission-1', { outcome: 'selected' as const, option: ALLOW_OPTION }]])
        }
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />,
    );

    expect(screen.queryByRole('button', { name: ALLOW_CHOICE_NAME })).toBeNull();
    const cache = screen.getByRole('button', { name: CACHE_CHOICE_NAME });
    expect(cache).toBeDefined();
    expect(document.activeElement).toBe(cache);
    expect(screen.getByText('1 of 3')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('pages standalone prompts out of order and keeps the cursor after one resolves', async () => {
    const user = userEvent.setup();
    const onRespondPermission = vi.fn();
    const first = permission('permission-a', 'Run A');
    const second = permission('permission-b', 'Run B');
    const third = permission('permission-c', 'Run C');
    const fourth = permission('permission-d', 'Run D');
    const standalone = conversation([first, second, third], {
      pendingPermissionIds: [first.requestId, second.requestId, third.requestId],
    });
    const expandedStandalone = conversation([first, second, third, fourth], {
      pendingPermissionIds: [first.requestId, second.requestId, third.requestId, fourth.requestId],
    });

    const { rerender } = render(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={standalone}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByText('Allow Run A?')).toBeDefined();
    expect(screen.getByText('1 of 3')).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'next prompt' }));
    expect(screen.getByText('Allow Run B?')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'submit' })).toBeNull();
    await user.click(screen.getByRole('button', { name: ALLOW_CHOICE_NAME }));
    expect(onRespondPermission).toHaveBeenCalledWith('permission-b', {
      outcome: 'selected',
      option: ALLOW_OPTION,
    });

    rerender(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={standalone}
        permissionDecisions={
          new Map([['permission-b', { outcome: 'selected' as const, option: ALLOW_OPTION }]])
        }
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByText('Allow Run C?')).toBeDefined();
    expect(screen.getByText('2 of 2')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ALLOW_CHOICE_NAME }));

    rerender(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={expandedStandalone}
        permissionDecisions={
          new Map([['permission-b', { outcome: 'selected' as const, option: ALLOW_OPTION }]])
        }
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByText('Allow Run C?')).toBeDefined();
    expect(screen.getByText('2 of 3')).toBeDefined();
    await user.click(screen.getByRole('link', { name: 'previous prompt' }));
    expect(screen.getByText('Allow Run A?')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('does not preempt or reset a question group when another group arrives', async () => {
    const user = userEvent.setup();
    const onRespondPermission = vi.fn();
    const onRespondQuestion = vi.fn();
    const questionOnly = conversation([ITEM], { pendingQuestionIds: ['request-1'] });
    const questionThenPermission = conversation([ITEM, PERMISSION_ITEM], {
      pendingPermissionIds: ['permission-1'],
      pendingQuestionIds: ['request-1'],
    });

    const { rerender } = render(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={questionOnly}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />,
    );

    await user.click(screen.getByRole('button', { name: CACHE_CHOICE_NAME }));

    rerender(
      <ConversationPromptDock
        answeredQuestionIds={new Set()}
        conversation={questionThenPermission}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />,
    );

    expect(
      screen.getByRole('button', { name: CACHE_CHOICE_NAME }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: ALLOW_CHOICE_NAME })).toBeNull();
    expect(screen.queryByRole('link', { name: 'next prompt' })).toBeNull();
    expect(screen.getByRole('link', { name: 'next question' })).toBeDefined();
    expect(screen.getByText('1 queued')).toBeDefined();
    expect(document.querySelectorAll('form')).toHaveLength(1);

    await user.click(screen.getByRole('link', { name: 'next question' }));
    await user.click(screen.getByRole('button', { name: NODE_CHOICE_NAME }));
    await user.click(screen.getByRole('button', { name: STABLE_CHOICE_NAME }));
    expect(onRespondQuestion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(onRespondQuestion).toHaveBeenCalledOnce();
    expect(onRespondPermission).not.toHaveBeenCalled();

    rerender(
      <ConversationPromptDock
        answeredQuestionIds={new Set(['request-1'])}
        conversation={questionThenPermission}
        permissionDecisions={new Map()}
        respondingPermissions={new Set()}
        respondingQuestions={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />,
    );

    const allow = screen.getByRole('button', { name: ALLOW_CHOICE_NAME });
    expect(document.activeElement).toBe(allow);
    expect(document.querySelectorAll('form')).toHaveLength(1);
    await user.click(allow);
    expect(onRespondPermission).toHaveBeenCalledOnce();
  });
});
