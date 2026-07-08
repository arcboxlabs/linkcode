import type { QuestionAnswer, QuestionOutcome } from '@linkcode/schema';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ConversationPromptAlert } from '../chat/conversation-prompt-alert';
import type { QuestionConversationItem } from '../chat/conversation-prompts';

/**
 * One agent question ask (1–4 questions), stepped through one question per card. Answers accumulate
 * locally and submit as ONE reply on the last step — the agent awaits a single response for the
 * whole ask. Skip declines the whole ask (the agent hears "declined", not partial answers).
 */
export function QuestionPrompt({
  action,
  item,
  responding,
  onRespond,
}: {
  action?: React.ReactNode;
  item: QuestionConversationItem;
  responding: boolean;
  onRespond: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.question');
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const index = Math.min(answers.length, item.questions.length - 1);
  const question = item.questions[index];
  const isLast = index === item.questions.length - 1;
  const header = question.header ?? t('badge');
  const badge =
    item.questions.length > 1
      ? `${header} · ${t('progress', { current: index + 1, total: item.questions.length })}`
      : header;

  return (
    <ConversationPromptAlert
      // Remount per question so the alert's selection state starts fresh on each step.
      key={question.questionId}
      className="my-0"
      action={action}
      badge={badge}
      choices={question.options.map((option) => ({
        id: option.optionId,
        label: option.label,
        description: option.description,
      }))}
      customInputPlaceholder={t('customPlaceholder')}
      mode={question.multiSelect ? 'multiple' : 'single'}
      submitting={responding}
      submitLabel={isLast ? undefined : t('next')}
      title={question.prompt}
      onSkip={() => onRespond(item.requestId, { outcome: 'cancelled' })}
      onSubmit={(response) => {
        const answer: QuestionAnswer = {
          questionId: question.questionId,
          selectedOptionIds: response.selectedIds,
          customText: response.customText,
        };
        if (isLast) {
          onRespond(item.requestId, { outcome: 'answered', answers: [...answers, answer] });
        } else {
          setAnswers((current) => [...current, answer]);
        }
      }}
    />
  );
}
