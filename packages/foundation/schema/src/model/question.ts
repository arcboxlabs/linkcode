import { z } from 'zod';
import { ToolCallUpdateSchema } from './tool-call';

/** Structured question flow (claude-code's AskUserQuestion). Distinct from the permission flow:
 * a permission ask is allow/deny over a tool's execution, while a question ask collects answers
 * that become the tool's own result. */

export const QuestionOptionSchema = z.object({
  optionId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  /** What choosing this option means (trade-offs, implications). */
  description: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

const QuestionOptionsSchema = z
  .array(QuestionOptionSchema)
  .min(1)
  .superRefine((options, ctx) => {
    const optionIds = new Set<string>();
    for (const [index, option] of options.entries()) {
      if (optionIds.has(option.optionId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'optionId'],
          message: `Duplicate question option ID: ${option.optionId}`,
        });
      }
      optionIds.add(option.optionId);
    }
  });

export const QuestionSchema = z.object({
  questionId: z.string().trim().min(1),
  /** The full question text. */
  prompt: z.string().trim().min(1),
  /** Very short chip/tag label (vendor-capped; claude-code caps it at 12 chars). */
  header: z.string().trim().min(1).optional(),
  /** Whether multiple options may be selected. */
  multiSelect: z.boolean(),
  options: QuestionOptionsSchema,
});
export type Question = z.infer<typeof QuestionSchema>;

/** The agent's question ask: which tool call is waiting, and the questions to answer. */
const QuestionsSchema = z
  .array(QuestionSchema)
  .min(1)
  .superRefine((questions, ctx) => {
    const questionIds = new Set<string>();
    for (const [index, question] of questions.entries()) {
      if (questionIds.has(question.questionId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'questionId'],
          message: `Duplicate question ID: ${question.questionId}`,
        });
      }
      questionIds.add(question.questionId);
    }
  });

export const QuestionRequestSchema = z.object({
  /** The asking tool call — pending-tracking joins on `toolCallId`, like the permission flow. */
  toolCall: ToolCallUpdateSchema,
  questions: QuestionsSchema,
});
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;

/** One question's answer: selected options, or free text typed instead of selecting. */
export const QuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  /** Chosen options; a single-select answer carries at most one entry. Empty with no
   * `customText` marks the question as skipped — adapters report it as unanswered. */
  selectedOptionIds: z.array(z.string().min(1)),
  /** Freeform answer typed instead of picking a structured option. */
  customText: z.string().optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

/** The user's reply to a question request: answers for every question, or a decline. */
export const QuestionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('answered'), answers: z.array(QuestionAnswerSchema).min(1) }),
  z.object({ outcome: z.literal('cancelled') }),
]);
export type QuestionOutcome = z.infer<typeof QuestionOutcomeSchema>;
