import type { Question, QuestionAnswer } from '@linkcode/schema';

export function answerText(question: Question, answer: QuestionAnswer): string | undefined {
  const labelByOption = new Map(question.options.map((option) => [option.optionId, option.label]));
  const parts = answer.selectedOptionIds.map((optionId) => labelByOption.get(optionId) ?? optionId);
  if (answer.customText) parts.push(answer.customText);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
