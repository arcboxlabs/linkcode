import type { QuestionAnswer, QuestionOutcome } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Form } from 'coss-ui/components/form';
import { CornerDownLeftIcon, InfoIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { choiceIndexForNumberShortcut } from '../chat/conversation-prompt-keyboard';
import type { QuestionConversationItem } from '../chat/conversation-prompts';
import { PromptCard } from './prompt-card';
import { QuestionPromptActions } from './question-prompt-actions';
import { QuestionChoices } from './question-prompt-choices';
import type { QuestionDraft } from './question-prompt-draft';
import { isQuestionAnswered } from './question-prompt-draft';

const EMPTY_RESPONSE: QuestionDraft = { selectedIds: [] };
type LastAction = 'dismiss' | 'submit' | null;

/** One atomic agent question request with local drafts and explicit, in-request navigation. */
export function QuestionPrompt({
  autoFocusFirstChoice = false,
  error,
  item,
  queuedCount = 0,
  responding,
  onRespond,
}: {
  autoFocusFirstChoice?: boolean;
  error?: string;
  item: QuestionConversationItem;
  queuedCount?: number;
  responding: boolean;
  onRespond: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.question');
  const tp = useTranslations('workbench.prompt');
  const [responses, setResponses] = useState<Map<string, QuestionDraft>>(() => new Map());
  const [customDrafts, setCustomDrafts] = useState<Map<string, string>>(() => new Map());
  const [index, setIndex] = useState(0);
  const [focusAfterNavigation, setFocusAfterNavigation] = useState(false);
  const [lastAction, setLastAction] = useState<LastAction>(null);
  const question = item.questions[index];
  const header = question.header ?? t('badge');
  const response = responses.get(question.questionId) ?? EMPTY_RESPONSE;
  const customDraft = customDrafts.get(question.questionId) ?? '';
  const isLastQuestion = index === item.questions.length - 1;
  const hasDrafts =
    [...responses].some(
      ([, candidate]) => candidate.selectedIds.length > 0 || candidate.customText !== undefined,
    ) || [...customDrafts].some(([, draft]) => draft.trim().length > 0);

  function selectPage(nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= item.questions.length) return;
    setFocusAfterNavigation(true);
    setIndex(nextIndex);
  }

  function updateResponse(nextResponse: QuestionDraft): void {
    setResponses((current) => new Map(current).set(question.questionId, nextResponse));
    // A structured single-select pick settles the page — advance automatically.
    if (
      !question.multiSelect &&
      nextResponse.customText === undefined &&
      nextResponse.selectedIds.length > 0
    ) {
      selectPage(index + 1);
    }
  }

  function updateCustomText(value: string): void {
    setCustomDrafts((current) => new Map(current).set(question.questionId, value));
    updateResponse({ selectedIds: [], customText: value });
  }

  function dismissRequest(): void {
    if (responding) return;
    setLastAction('dismiss');
    onRespond(item.requestId, { outcome: 'cancelled' });
  }

  function submitGroup(): void {
    if (responding) return;
    // Unanswered questions ride as explicit empty answers so the agent hears they were skipped.
    const answers: QuestionAnswer[] = item.questions.map((candidate) => {
      const candidateResponse = responses.get(candidate.questionId);
      if (!candidateResponse || !isQuestionAnswered(candidate, candidateResponse)) {
        return { questionId: candidate.questionId, selectedOptionIds: [] };
      }
      return {
        questionId: candidate.questionId,
        selectedOptionIds: candidateResponse.selectedIds,
        customText: candidateResponse.customText?.trim() || undefined,
      };
    });
    setLastAction('submit');
    onRespond(item.requestId, { outcome: 'answered', answers });
  }

  function retry(): void {
    if (lastAction === 'dismiss') dismissRequest();
    else submitGroup();
  }

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    if (isLastQuestion) submitGroup();
    else selectPage(index + 1);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>): void {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.nativeEvent.isComposing ||
      event.key === 'Process' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      responding ||
      isEditableTarget(event.target)
    ) {
      return;
    }

    const optionIndex = choiceIndexForNumberShortcut(event.code, event.key);
    if (optionIndex === null) return;
    const option = question.options.at(optionIndex);
    if (!option) return;

    event.preventDefault();
    const selectedIds = question.multiSelect
      ? response.selectedIds.includes(option.optionId)
        ? response.selectedIds.filter((optionId) => optionId !== option.optionId)
        : [...response.selectedIds, option.optionId]
      : [option.optionId];
    updateResponse({ selectedIds });
    event.currentTarget
      .querySelectorAll<HTMLElement>('[data-prompt-choice]')
      .item(optionIndex)
      .focus();
  }

  return (
    <Form data-keyboard-shortcut-local="" onKeyDown={handleKeyDown} onSubmit={handleSubmit}>
      <PromptCard
        badge={header}
        busyLabel={lastAction ? undefined : tp('responding')}
        disabled={responding}
        error={
          error && lastAction
            ? {
                message: error,
                retryLabel: tp('retry'),
                onRetry: retry,
              }
            : undefined
        }
        footer={
          <>
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
              <InfoIcon aria-hidden className="size-3 shrink-0" />
              {/* line height mirrors the xs submit button so the footer height is stable across pages */}
              <span className="min-w-0 truncate leading-7 sm:leading-6">
                {t(question.multiSelect ? 'instructionMultiple' : 'instructionSingle')}
              </span>
            </span>
            <Button
              disabled={responding}
              loading={responding && lastAction === 'submit'}
              size="xs"
              type="submit"
            >
              {isLastQuestion ? t('submit') : t('nextAction')}
              <CornerDownLeftIcon />
            </Button>
          </>
        }
        meta={
          <QuestionPromptActions
            current={index + 1}
            disabled={responding}
            dismissLoading={responding && lastAction === 'dismiss'}
            hasDrafts={hasDrafts}
            queuedCount={queuedCount}
            total={item.questions.length}
            onDismiss={dismissRequest}
            onNext={() => selectPage(index + 1)}
            onPrevious={() => selectPage(index - 1)}
          />
        }
        title={question.prompt}
      >
        <QuestionChoices
          key={question.questionId}
          autoFocus={autoFocusFirstChoice || focusAfterNavigation}
          customDraft={customDraft}
          disabled={responding}
          question={question}
          response={response}
          onCustomTextChange={updateCustomText}
          onResponseChange={updateResponse}
        />
      </PromptCard>
    </Form>
  );
}

function isEditableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}
