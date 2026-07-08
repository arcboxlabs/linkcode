import { z } from 'zod';
import { ToolCallUpdateSchema } from './tool-call';

/**
 * Structured question flow — the agent asks the user to choose among options (claude-code's
 * AskUserQuestion tool). Distinct from the permission flow: a permission ask is allow/deny over a
 * tool's execution, while a question ask collects answers that become the tool's own result.
 */

export const QuestionOptionSchema = z.object({
  optionId: z.string().min(1),
  label: z.string().min(1),
  /** What choosing this option means (trade-offs, implications). */
  description: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const QuestionSchema = z.object({
  questionId: z.string().min(1),
  /** The full question text. */
  prompt: z.string().min(1),
  /** Very short chip/tag label (vendor-capped; claude-code caps it at 12 chars). */
  header: z.string().optional(),
  /** Whether multiple options may be selected. */
  multiSelect: z.boolean(),
  options: z.array(QuestionOptionSchema).min(1),
});
export type Question = z.infer<typeof QuestionSchema>;

/** The agent's question ask: which tool call is waiting, and the questions to answer. */
export const QuestionRequestSchema = z.object({
  /** The asking tool call — pending-tracking joins on `toolCallId`, like the permission flow. */
  toolCall: ToolCallUpdateSchema,
  questions: z.array(QuestionSchema).min(1),
});
export type QuestionRequest = z.infer<typeof QuestionRequestSchema>;

/** One question's answer: selected options, or free text typed instead of selecting. */
export const QuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  /** Chosen options; a single-select answer carries exactly one entry. */
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
