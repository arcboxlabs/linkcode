import type { Question } from '@linkcode/schema';

export interface QuestionDraft {
  selected: string[];
  customText: string;
}

export interface QuestionPageProps {
  question: Question;
  draft: QuestionDraft;
  current: number;
  total: number;
  isLast: boolean;
  responding: boolean;
  onDraftChange: (draft: QuestionDraft) => void;
  onAdvance: (draft: QuestionDraft) => void;
  onPrevious: (draft: QuestionDraft) => void;
  onSelectOption: (optionId: string) => void;
  onCancel: () => void;
}
