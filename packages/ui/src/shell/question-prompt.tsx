import type { QuestionAnswer, QuestionOutcome } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { ConversationPromptResponse } from '../chat/conversation-prompt';
import { isConversationPromptResponseSubmittable } from '../chat/conversation-prompt';
import { ConversationPromptAlert } from '../chat/conversation-prompt-alert';
import type { QuestionConversationItem } from '../chat/conversation-prompts';
import { PromptPager } from './prompt-pager';

const EMPTY_RESPONSE: ConversationPromptResponse = { selectedIds: [] };

/** One agent question group, paged within one card. Drafts and skips stay local until one
 * aggregate reply submits the whole group — the pager never crosses into standalone prompts. */
export function QuestionPrompt({
  autoFocusFirstChoice = false,
  item,
  queuedCount = 0,
  responding,
  onRespond,
}: {
  autoFocusFirstChoice?: boolean;
  item: QuestionConversationItem;
  queuedCount?: number;
  responding: boolean;
  onRespond: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.question');
  const [responses, setResponses] = useState<Map<string, ConversationPromptResponse>>(
    () => new Map(),
  );
  const [skippedQuestionIds, setSkippedQuestionIds] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [focusAfterNavigation, setFocusAfterNavigation] = useState(false);
  const question = item.questions[index];
  const header = question.header ?? t('badge');
  const response = responses.get(question.questionId) ?? EMPTY_RESPONSE;
  const skipped = skippedQuestionIds.includes(question.questionId);
  const allResolved = item.questions.every((candidate) => {
    if (skippedQuestionIds.includes(candidate.questionId)) return true;
    const candidateResponse = responses.get(candidate.questionId);
    return candidateResponse ? isQuestionAnswered(candidate, candidateResponse) : false;
  });

  function selectPage(nextIndex: number): void {
    if (nextIndex < 0 || nextIndex >= item.questions.length) return;
    setFocusAfterNavigation(true);
    setIndex(nextIndex);
  }

  function updateResponse(nextResponse: ConversationPromptResponse): void {
    setResponses((current) => new Map(current).set(question.questionId, nextResponse));
    setSkippedQuestionIds((current) =>
      current.filter((questionId) => questionId !== question.questionId),
    );
    if (!question.multiSelect && nextResponse.selectedIds.length === 1) {
      selectPage(index + 1);
    }
  }

  function skipQuestion(): void {
    setResponses((current) => {
      const next = new Map(current);
      next.delete(question.questionId);
      return next;
    });
    setSkippedQuestionIds((current) =>
      current.includes(question.questionId) ? current : [...current, question.questionId],
    );
    selectPage(index + 1);
  }

  function submitGroup(): void {
    if (!allResolved || responding) return;
    const answers: QuestionAnswer[] = [];
    for (const candidate of item.questions) {
      const candidateResponse = responses.get(candidate.questionId);
      if (!candidateResponse || !isQuestionAnswered(candidate, candidateResponse)) continue;
      answers.push({
        questionId: candidate.questionId,
        selectedOptionIds: candidateResponse.selectedIds,
        customText: candidateResponse.customText?.trim() || undefined,
      });
    }
    onRespond(
      item.requestId,
      answers.length > 0 ? { outcome: 'answered', answers } : { outcome: 'cancelled' },
    );
  }

  return (
    <ConversationPromptAlert
      // Remount the visible page; controlled drafts restore its prior answer when revisited.
      key={question.questionId}
      className="my-0"
      action={
        item.questions.length > 1 || queuedCount > 0 ? (
          <PromptPager
            current={index + 1}
            disabled={responding}
            nextLabel={t('next')}
            previousLabel={t('previous')}
            queued={queuedCount}
            total={item.questions.length}
            onNext={() => selectPage(index + 1)}
            onPrevious={() => selectPage(index - 1)}
          />
        ) : undefined
      }
      autoFocusFirstChoice={autoFocusFirstChoice || focusAfterNavigation}
      badge={header}
      choices={question.options.map((option) => ({
        id: option.optionId,
        label: option.label,
        description: option.description,
      }))}
      customInputPlaceholder={t('customPlaceholder')}
      footerAction={
        <Button
          disabled={!allResolved || responding}
          loading={responding}
          size="xs"
          type="button"
          onClick={submitGroup}
        >
          {t('submit')}
        </Button>
      }
      mode={question.multiSelect ? 'multiple' : 'single'}
      response={response}
      skipLabel={skipped ? t('skipped') : undefined}
      submitting={responding}
      title={question.prompt}
      onResponseChange={updateResponse}
      onSkip={skipQuestion}
    />
  );
}

function isQuestionAnswered(
  question: QuestionConversationItem['questions'][number],
  response: ConversationPromptResponse,
): boolean {
  return isConversationPromptResponseSubmittable(
    {
      mode: question.multiSelect ? 'multiple' : 'single',
      choices: question.options.map((option) => ({ id: option.optionId, label: option.label })),
    },
    response,
  );
}
