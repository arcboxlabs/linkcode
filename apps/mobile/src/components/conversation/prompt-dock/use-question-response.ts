import type { Question, QuestionOutcome } from '@linkcode/schema';
import { useState } from 'react';
import type { QuestionDraft } from './question-page.types';

export function useQuestionResponse(
  questions: Question[],
  responding: boolean,
  onRespond: (outcome: QuestionOutcome) => void,
) {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const question = questions[index];
  const draft = drafts[question.questionId] ?? { selected: [], customText: '' };
  const isLast = index === questions.length - 1;

  const setDraft = (next: QuestionDraft): void => {
    if (responding) return;
    setDrafts((current) => ({ ...current, [question.questionId]: next }));
  };

  const advance = (next: QuestionDraft): void => {
    if (responding) return;
    setDraft(next);
    if (!isLast) {
      setIndex((current) => current + 1);
      return;
    }
    onRespond({
      outcome: 'answered',
      answers: questions.map((entry) => {
        const value =
          entry.questionId === question.questionId
            ? next
            : (drafts[entry.questionId] ?? { selected: [], customText: '' });
        const customText = value.customText.trim();
        return {
          questionId: entry.questionId,
          selectedOptionIds: customText ? [] : value.selected,
          ...(customText && { customText }),
        };
      }),
    });
  };

  const selectOption = (optionId: string): void => {
    if (responding) return;
    const selected = question.multiSelect
      ? draft.selected.includes(optionId)
        ? draft.selected.filter((id) => id !== optionId)
        : [...draft.selected, optionId]
      : [optionId];
    const next = { selected, customText: '' };
    if (question.multiSelect) setDraft(next);
    else advance(next);
  };

  const previous = (next: QuestionDraft): void => {
    if (responding || index === 0) return;
    setDraft(next);
    setIndex((current) => current - 1);
  };

  return {
    question,
    draft,
    current: index + 1,
    total: questions.length,
    isLast,
    setDraft,
    advance,
    previous,
    selectOption,
  };
}
