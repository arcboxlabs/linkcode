import type { Question, QuestionAnswer, QuestionOutcome } from '@linkcode/schema';
import { useState } from 'react';
import { QuestionPage } from './question-page';
import type { QuestionDraft } from './question-page.types';

/**
 * One agent question batch pages within its card (desktop `question-prompt.tsx`): tappable
 * option rows draw their own selection state, `multiSelect` toggles, single-select
 * auto-advances, an optional free-text answer, and the whole batch resolves as one
 * `QuestionOutcome`. The page rendering is platform-split; this orchestrator is shared.
 */
export function QuestionPrompt({
  questions,
  responding,
  onRespond,
}: {
  questions: Question[];
  responding: boolean;
  onRespond: (outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});

  const question = questions[Math.min(index, questions.length - 1)];
  const draft = drafts[question.questionId] ?? { selected: [], customText: '' };
  const isLast = index >= questions.length - 1;

  const setDraft = (next: QuestionDraft): void => {
    setDrafts((current) => ({ ...current, [question.questionId]: next }));
  };

  const buildAnswers = (finalDraft: QuestionDraft): QuestionAnswer[] =>
    questions.map((entry) => {
      const value =
        entry.questionId === question.questionId
          ? finalDraft
          : (drafts[entry.questionId] ?? { selected: [], customText: '' });
      const text = value.customText.trim();
      return {
        questionId: entry.questionId,
        selectedOptionIds: value.selected,
        ...(text.length > 0 && { customText: text }),
      };
    });

  const advanceOrSubmit = (finalDraft: QuestionDraft): void => {
    if (isLast) {
      onRespond({ outcome: 'answered', answers: buildAnswers(finalDraft) });
    } else {
      setDraft(finalDraft);
      setIndex((current) => current + 1);
    }
  };

  return (
    <QuestionPage
      key={`${question.questionId}:${draft.selected.join(',')}`}
      question={question}
      draft={draft}
      current={index + 1}
      total={questions.length}
      isLast={isLast}
      responding={responding}
      onDraftChange={setDraft}
      onAdvance={advanceOrSubmit}
      onCancel={() => onRespond({ outcome: 'cancelled' })}
    />
  );
}
