import type { QuestionConversationItem } from '../chat/conversation-prompts';

export interface QuestionDraft {
  selectedIds: string[];
  customText?: string;
}

export function isQuestionAnswered(
  question: QuestionConversationItem['questions'][number],
  response: QuestionDraft,
): boolean {
  if (response.customText !== undefined) {
    return response.selectedIds.length === 0 && response.customText.trim().length > 0;
  }
  const optionIds = new Set(question.options.map((option) => option.optionId));
  if (!response.selectedIds.every((optionId) => optionIds.has(optionId))) return false;
  return question.multiSelect ? response.selectedIds.length > 0 : response.selectedIds.length === 1;
}
