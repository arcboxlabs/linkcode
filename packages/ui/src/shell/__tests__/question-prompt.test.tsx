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
  if (namespace === 'workbench.question' && key === 'nextAction') return 'Next';
  if (namespace === 'workbench.question' && key === 'navigation') return 'Question navigation';
  if (namespace === 'workbench.question' && key === 'instructionSingle') return 'Choose one';
  if (namespace === 'workbench.question' && key === 'instructionMultiple') {
    return 'Select all that apply';
  }
  if (namespace === 'workbench.question' && key === 'other') return 'Other';
  if (namespace === 'workbench.question' && key === 'dismiss') return 'Dismiss request';
  if (namespace === 'workbench.question' && key === 'dismissConfirmTitle') {
    return 'Dismiss this request?';
  }
  if (namespace === 'workbench.question' && key === 'dismissConfirmDescription') {
    return 'Your draft answers will be discarded.';
  }
  if (namespace === 'workbench.question' && key === 'dismissConfirmCancel') {
    return 'Keep answering';
  }
  if (namespace === 'workbench.question' && key === 'dismissConfirmAction') {
    return 'Dismiss anyway';
  }
  if (namespace === 'workbench.prompt' && key === 'retry') return 'Retry';
  if (namespace === 'workbench.permission' && key === 'question') {
    return `Allow ${String(values?.action)}?`;
  }
  if (namespace === 'workbench.permission' && key === 'reviewRequired') {
    return 'Permission required';
  }
  if (namespace === 'workbench.permission' && key === 'reviewDescription') {
    return 'Review the details before allowing it.';
  }
  if (namespace === 'workbench.permission' && key === 'responding') return 'Submitting…';
  if (namespace === 'workbench.prompt' && key === 'responding') return 'Submitting…';
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
  responding: false,
  questions: [
    {
      questionId: 'q1',
      prompt: 'Pick features',
      header: 'Features',
      multiSelect: true,
      options: [
        {
          optionId: 'cache',
          label: 'Cache',
          description: 'Reuse fetched results across the whole workspace without truncation.',
        },
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
const ALWAYS_ALLOW_OPTION = {
  optionId: 'allow-always',
  name: 'Always allow',
  kind: 'allow_always' as const,
};
const PERMISSION_ITEM: PermissionConversationItem = {
  kind: 'approval',
  id: 'permission-1',
  turnId: 'turn-1',
  requestId: 'permission-1',
  toolCall: { toolCallId: 'command-1', title: 'Run command' },
  options: [
    ALLOW_OPTION,
    ALWAYS_ALLOW_OPTION,
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
  responding: false,
};

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
    availableModels: null,
    capabilities: null,
    stopReason: null,
    pendingPermissionIds: [],
    pendingQuestionIds: [],
    ...overrides,
  };
}

const CACHE_CHOICE_NAME = /Cache/;
const CACHE_DESCRIPTION_TEXT =
  'Reuse fetched results across the whole workspace without truncation.';
const CACHE_DESCRIPTION = /Reuse fetched results/;
const NODE_CHOICE_NAME = /Node/;
const STABLE_CHOICE_NAME = /Stable/;
const ALLOW_CHOICE_NAME = /^Allow$/;
const SUBMIT_BUTTON_NAME = /submit/i;
const SKIP_BUTTON_NAME = /skip/i;

afterEach(cleanup);

describe('QuestionPrompt', () => {
  it('shows an authoritative busy state without a local action snapshot', () => {
    render(<QuestionPrompt item={ITEM} responding onRespond={vi.fn()} />);

    expect(screen.getByRole('status', { name: 'Submitting…' })).toBeDefined();
    expect(
      screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }).getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('uses native choice semantics, explicit navigation, and one ordered batch submission', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);

    expect(screen.getByText('1 of 3')).toBeDefined();
    const cache = screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME });
    expect(screen.getByText('Select all that apply')).toBeDefined();
    const cacheDescription = screen.getByText(CACHE_DESCRIPTION);
    expect(cacheDescription.classList.contains('truncate')).toBe(true);
    expect(cacheDescription.closest('label')?.classList.contains('flex')).toBe(true);

    await user.click(cache);

    // Multi-select stays put; the always-present footer action advances.
    expect(screen.getByText('1 of 3')).toBeDefined();
    expect(cache.getAttribute('aria-checked')).toBe('true');
    expect(onRespond).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2 of 3')).toBeDefined();

    // A structured single-select pick advances automatically.
    await user.click(screen.getByRole('radio', { name: NODE_CHOICE_NAME }));
    expect(screen.getByText('3 of 3')).toBeDefined();
    expect(onRespond).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'previous question' }));
    expect(screen.getByRole('radio', { name: NODE_CHOICE_NAME }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'previous question' }));
    expect(
      screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'next question' }));
    await user.click(screen.getByRole('button', { name: 'next question' }));
    await user.click(screen.getByRole('radio', { name: STABLE_CHOICE_NAME }));
    expect(screen.getByText('3 of 3')).toBeDefined();
    expect(onRespond).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond).toHaveBeenCalledWith('request-1', {
      outcome: 'answered',
      answers: [
        { questionId: 'q1', selectedOptionIds: ['cache'], customText: undefined },
        { questionId: 'q2', selectedOptionIds: ['node'], customText: undefined },
        { questionId: 'q3', selectedOptionIds: ['stable'], customText: undefined },
      ],
    });
  });

  it('lets the pager skip questions and submits unanswered ones as explicit skips', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);

    const next = screen.getByRole('button', { name: 'next question' });
    expect(next.hasAttribute('disabled')).toBe(false);
    await user.click(next);
    expect(screen.getByText('2 of 3')).toBeDefined();
    await user.click(screen.getByRole('radio', { name: NODE_CHOICE_NAME }));
    expect(screen.getByText('3 of 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'submit' }));

    expect(onRespond).toHaveBeenCalledOnce();
    expect(onRespond).toHaveBeenCalledWith('request-1', {
      outcome: 'answered',
      answers: [
        { questionId: 'q1', selectedOptionIds: [] },
        { questionId: 'q2', selectedOptionIds: ['node'], customText: undefined },
        { questionId: 'q3', selectedOptionIds: [] },
      ],
    });
  });

  it('treats Other as an exclusive choice and restores its draft', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);

    await user.click(screen.getByRole('button', { name: 'customPlaceholder' }));
    let input = screen.getByRole<HTMLInputElement>('textbox', { name: 'customPlaceholder' });
    await user.type(input, 'Run smoke tests');

    await user.click(screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }));
    expect(screen.queryByRole('textbox', { name: 'customPlaceholder' })).toBeNull();
    expect(screen.getByRole('button', { name: 'customPlaceholder' }).textContent).toContain(
      'Run smoke tests',
    );
    expect(
      screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: 'customPlaceholder' }));
    input = screen.getByRole<HTMLInputElement>('textbox', { name: 'customPlaceholder' });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'customPlaceholder' }).value).toBe(
      'Run smoke tests',
    );
    expect(
      screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }).getAttribute('aria-checked'),
    ).toBe('false');

    await user.click(screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }));
    await user.click(screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }));
    await user.click(screen.getByRole('button', { name: 'Dismiss request' }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeDefined();
  });

  it('supports numbered shortcuts without stealing digits from the custom answer', async () => {
    const user = userEvent.setup();
    render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );

    expect(screen.getByText('1', { selector: 'kbd' })).toBeDefined();
    await user.keyboard('1');
    expect(
      screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.keyboard('2');
    expect(screen.getByRole('checkbox', { name: /Retry/ }).getAttribute('aria-checked')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'customPlaceholder' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'customPlaceholder' });
    await user.type(input, '123');
    expect(input.value).toBe('123');
    expect(
      screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('anchors the truncated description tooltip to the keyboard-focusable choice row', () => {
    render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );
    const choice = screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME });
    const row = choice.closest('label');
    const description = row?.querySelector('.truncate');
    expect(description?.textContent).toBe(CACHE_DESCRIPTION_TEXT);
    expect(row?.getAttribute('data-slot')).toBe('tooltip-trigger');
    expect(row?.contains(choice)).toBe(true);
    expect(document.activeElement).toBe(choice);
  });

  it('does not replace a structured answer when keyboard focus reaches the custom choice', async () => {
    const user = userEvent.setup();
    render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );
    const cache = screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME });
    await user.click(cache);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'customPlaceholder' }));
    expect(cache.getAttribute('aria-checked')).toBe('true');
  });

  it('ignores modified numbered shortcuts and shortcuts while responding', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );
    const cache = screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME });
    await user.keyboard('{Shift>}1{/Shift}');
    expect(cache.getAttribute('aria-checked')).toBe('false');

    rerender(<QuestionPrompt autoFocusFirstChoice item={ITEM} responding onRespond={vi.fn()} />);
    await user.keyboard('1');
    expect(cache.getAttribute('aria-checked')).toBe('false');
  });

  it('dismisses the whole request and confirms before discarding drafts', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const firstRender = render(
      <QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />,
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss request' }));
    expect(onRespond).toHaveBeenCalledWith('request-1', { outcome: 'cancelled' });

    firstRender.unmount();
    onRespond.mockClear();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);
    await user.click(screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }));
    await user.click(screen.getByRole('button', { name: 'Dismiss request' }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Keep answering' }));
    expect(onRespond).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Dismiss request' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss anyway' }));
    expect(onRespond).toHaveBeenCalledWith('request-1', { outcome: 'cancelled' });
  });

  it('dismisses without confirmation when the custom answer was cleared', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />);

    await user.click(screen.getByRole('button', { name: 'customPlaceholder' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'customPlaceholder' });
    await user.type(input, 'draft');
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Dismiss request' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onRespond).toHaveBeenCalledWith('request-1', { outcome: 'cancelled' });
  });

  it('moves focus to the next question, not the outgoing control, on a single-select shortcut', async () => {
    const user = userEvent.setup();
    render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'next question' }));
    const bun = screen.getByRole('radio', { name: /Bun/ });
    const focusTargets: EventTarget[] = [];
    const record = (event: FocusEvent): void => {
      if (event.target) focusTargets.push(event.target);
    };
    document.addEventListener('focusin', record);
    await user.keyboard('2');
    document.removeEventListener('focusin', record);

    expect(screen.getByText('3 of 3')).toBeDefined();
    expect(focusTargets).not.toContain(bun);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: STABLE_CHOICE_NAME }));

    // The last question has no page to advance to, so the shortcut focuses the pressed choice.
    await user.keyboard('2');
    expect(screen.getByText('3 of 3')).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Canary/ }));
  });

  it('moves focus through choices and the custom row with arrow keys without selecting', async () => {
    const user = userEvent.setup();
    render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );
    const cache = screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME });
    const retry = screen.getByRole('checkbox', { name: /Retry/ });

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(retry);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'customPlaceholder' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cache);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'customPlaceholder' }));
    expect(cache.getAttribute('aria-checked')).toBe('false');
    expect(retry.getAttribute('aria-checked')).toBe('false');
  });

  it('keeps arrow navigation focus-only on single-select pages', async () => {
    const user = userEvent.setup();
    render(
      <QuestionPrompt autoFocusFirstChoice item={ITEM} responding={false} onRespond={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'next question' }));

    await user.keyboard('{ArrowDown}');
    const bun = screen.getByRole('radio', { name: /Bun/ });
    expect(document.activeElement).toBe(bun);
    expect(bun.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('2 of 3')).toBeDefined();
  });

  it('arrows from the custom input back into the option list', async () => {
    const user = userEvent.setup();
    render(<QuestionPrompt item={ITEM} responding={false} onRespond={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'customPlaceholder' }));
    expect(document.activeElement).toBe(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'customPlaceholder' }),
    );

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /Retry/ }));
    // Navigating away only moves focus; the custom answer stays selected.
    expect(screen.getByRole('textbox', { name: 'customPlaceholder' })).toBeDefined();
  });

  it('keeps the draft visible after a failed submission and retries the same answers', async () => {
    const user = userEvent.setup();
    const onRespond = vi.fn();
    const { rerender } = render(
      <QuestionPrompt item={ITEM} responding={false} onRespond={onRespond} />,
    );

    await user.click(screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME }));
    await user.click(screen.getByRole('button', { name: 'next question' }));
    await user.click(screen.getByRole('radio', { name: NODE_CHOICE_NAME }));
    await user.click(screen.getByRole('radio', { name: STABLE_CHOICE_NAME }));
    await user.click(screen.getByRole('button', { name: 'submit' }));
    expect(onRespond).toHaveBeenCalledOnce();

    rerender(<QuestionPrompt item={ITEM} responding onRespond={onRespond} />);
    expect(screen.getByRole('button', { name: SUBMIT_BUTTON_NAME }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Dismiss request' }).hasAttribute('disabled')).toBe(
      true,
    );

    rerender(
      <QuestionPrompt
        error="Could not send response"
        item={ITEM}
        responding={false}
        onRespond={onRespond}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not send response');
    expect(screen.getByText('3 of 3')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRespond).toHaveBeenCalledTimes(2);
    expect(onRespond.mock.calls[1]).toEqual(onRespond.mock.calls[0]);
  });
});

describe('ConversationPromptDock', () => {
  it('places the current plan step before the actionable prompt', () => {
    const userMessage: ConversationViewModel['items'][number] = {
      kind: 'message',
      id: 'turn-1',
      turnId: 'turn-1',
      role: 'user',
      blocks: [],
      isStreaming: false,
    };
    const currentPlan: ConversationViewModel['items'][number] = {
      kind: 'plan',
      id: 'plan-1',
      turnId: 'turn-1',
      plan: {
        entries: [
          { content: 'Done', priority: 'high', status: 'completed' },
          { content: 'Review prompt', priority: 'high', status: 'in_progress' },
        ],
      },
    };

    render(
      <ConversationPromptDock
        conversation={conversation([userMessage, currentPlan, ITEM], {
          pendingQuestionIds: [ITEM.requestId],
        })}
        respondingRequestIds={new Set()}
        onRespondPermission={vi.fn()}
        onRespondQuestion={vi.fn()}
      />,
    );

    const step = screen.getByText('Review prompt');
    const prompt = screen.getByText('Pick features').closest('[data-slot="frame"]');
    if (!prompt) throw new Error('prompt card not found');
    expect(step.compareDocumentPosition(prompt)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows an authoritative busy state without a local response snapshot', () => {
    render(
      <ConversationPromptDock
        conversation={conversation([{ ...PERMISSION_ITEM, responding: true }], {
          pendingPermissionIds: [PERMISSION_ITEM.requestId],
        })}
        respondingRequestIds={new Set()}
        onRespondPermission={vi.fn()}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByRole('status', { name: 'Submitting…' })).toBeDefined();
    expect(screen.getByRole('button', { name: ALLOW_CHOICE_NAME }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows one FIFO request, separates backlog, and waits for authoritative resolution', async () => {
    const user = userEvent.setup();
    const onRespondPermission = vi.fn();
    const permissionThenQuestion = conversation([PERMISSION_ITEM, ITEM], {
      pendingPermissionIds: ['permission-1'],
      pendingQuestionIds: ['request-1'],
    });
    const { rerender } = render(
      <ConversationPromptDock
        conversation={permissionThenQuestion}
        respondingRequestIds={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: ALLOW_CHOICE_NAME })).toBeDefined();
    expect(screen.getByText('Permission required')).toBeDefined();
    expect(screen.getByText('Review the details before allowing it.')).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: CACHE_CHOICE_NAME })).toBeNull();
    expect(screen.getByText('1 queued')).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: SKIP_BUTTON_NAME })).toBeNull();
    const allow = screen.getByRole('button', { name: ALLOW_CHOICE_NAME });
    const footerLabels = [
      ...(allow.closest('[data-slot="frame-panel-footer"]')?.querySelectorAll('button') ?? []),
    ].map((button) => button.textContent);
    expect(footerLabels).toEqual(['Always allow', 'Reject', 'Allow']);

    await user.click(allow);
    expect(onRespondPermission).toHaveBeenCalledWith('permission-1', {
      outcome: 'selected',
      option: ALLOW_OPTION,
    });
    expect(screen.getByText('Allow Run command?')).toBeDefined();

    const resolvedPermission: PermissionConversationItem = {
      ...PERMISSION_ITEM,
      resolution: {
        outcome: { outcome: 'selected', optionId: ALLOW_OPTION.optionId },
        source: 'user',
      },
    };
    rerender(
      <ConversationPromptDock
        conversation={conversation([resolvedPermission, ITEM], {
          pendingQuestionIds: ['request-1'],
        })}
        respondingRequestIds={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: ALLOW_CHOICE_NAME })).toBeNull();
    expect(screen.getByRole('checkbox', { name: CACHE_CHOICE_NAME })).toBeDefined();
  });

  it('renders complete approval details and retries an inline response failure', async () => {
    const user = userEvent.setup();
    const onRespondPermission = vi.fn();
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
    const { rerender } = render(
      <ConversationPromptDock
        conversation={customConversation}
        respondingRequestIds={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );

    const argumentsValue = screen.getByText('arguments').nextElementSibling;
    expect(argumentsValue?.textContent).toBe(JSON.stringify(rawInput, null, 2));
    expect(argumentsValue?.classList.contains('truncate')).toBe(false);
    expect(argumentsValue?.classList.contains('whitespace-pre-wrap')).toBe(true);
    await user.click(screen.getByRole('button', { name: ALLOW_CHOICE_NAME }));

    rerender(
      <ConversationPromptDock
        conversation={customConversation}
        responseErrors={new Map([[customPermission.requestId, 'Response rejected']])}
        respondingRequestIds={new Set()}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Response rejected');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRespondPermission).toHaveBeenCalledTimes(2);
    expect(onRespondPermission.mock.calls[1]).toEqual(onRespondPermission.mock.calls[0]);
  });

  it('shows only the raw arguments for unrecognized tools instead of duplicating fields', () => {
    const rawInput = { command: 'pnpm dlx tool', url: 'https://example.com', path: '/tmp/x' };
    const otherPermission: PermissionConversationItem = {
      ...PERMISSION_ITEM,
      toolCall: { toolCallId: 'mcp-2', title: 'mcp.run', kind: 'other', rawInput },
    };
    render(
      <ConversationPromptDock
        conversation={conversation([otherPermission], {
          pendingPermissionIds: [otherPermission.requestId],
        })}
        respondingRequestIds={new Set()}
        onRespondPermission={vi.fn()}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByText('arguments').nextElementSibling?.textContent).toBe(
      JSON.stringify(rawInput, null, 2),
    );
    expect(screen.queryByText('command')).toBeNull();
    expect(screen.queryByText('url')).toBeNull();
    expect(screen.queryByText('file')).toBeNull();
  });

  it('keeps dedicated detail rows for recognized tool kinds', () => {
    const execPermission: PermissionConversationItem = {
      ...PERMISSION_ITEM,
      toolCall: {
        toolCallId: 'exec-1',
        title: 'Run migration',
        kind: 'execute',
        rawInput: { command: 'pnpm migrate' },
      },
    };
    render(
      <ConversationPromptDock
        conversation={conversation([execPermission], {
          pendingPermissionIds: [execPermission.requestId],
        })}
        respondingRequestIds={new Set()}
        onRespondPermission={vi.fn()}
        onRespondQuestion={vi.fn()}
      />,
    );

    expect(screen.getByText('command').nextElementSibling?.textContent).toBe('pnpm migrate');
    expect(screen.queryByText('arguments')).toBeNull();
  });
});
