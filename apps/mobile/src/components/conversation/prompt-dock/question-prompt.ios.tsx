import type { Question, QuestionOutcome } from '@linkcode/schema';
import { QuestionPage } from './question-page.ios';
import { useQuestionResponse } from './use-question-response';

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
  const { question, draft, current, total, isLast, setDraft, advance, previous, selectOption } =
    useQuestionResponse(questions, responding, onRespond);

  return (
    <QuestionPage
      key={`${question.questionId}:${draft.selected.join(',')}`}
      question={question}
      draft={draft}
      current={current}
      total={total}
      isLast={isLast}
      responding={responding}
      onDraftChange={setDraft}
      onAdvance={advance}
      onPrevious={previous}
      onSelectOption={selectOption}
      onCancel={() => onRespond({ outcome: 'cancelled' })}
    />
  );
}
