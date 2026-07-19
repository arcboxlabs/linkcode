import type { AgentEvent, AgentInput } from '@linkcode/schema';
import { RequestError } from '../failure';

export type AskEvent = Extract<AgentEvent, { type: 'permission-request' | 'question-request' }>;
export type AskResponseInput = Extract<
  AgentInput,
  { type: 'permission-response' | 'question-response' }
>;
export type AskResolutionEvent = Extract<
  AgentEvent,
  { type: 'permission-resolved' | 'question-resolved' }
>;

export function validateAskResponse(request: AskEvent, input: AskResponseInput): void {
  if (input.type === 'permission-response') {
    if (request.type !== 'permission-request') {
      throw invalidRequest(`Request ${input.requestId} does not accept a permission response`);
    }
    if (input.outcome.outcome === 'selected') {
      const { optionId } = input.outcome;
      if (!request.options.some((option) => option.optionId === optionId)) {
        throw invalidRequest(`Unknown permission option: ${optionId}`);
      }
    }
    return;
  }

  if (request.type !== 'question-request') {
    throw invalidRequest(`Request ${input.requestId} does not accept a question response`);
  }
  if (input.outcome.outcome === 'cancelled') return;
  if (input.outcome.answers.length !== request.questions.length) {
    throw invalidRequest(`Question response must answer every question in ${input.requestId}`);
  }

  const questions = new Map(request.questions.map((question) => [question.questionId, question]));
  if (questions.size !== request.questions.length) {
    throw invalidRequest(`Question request ${input.requestId} has duplicate question IDs`);
  }
  const answers = new Map<string, (typeof input.outcome.answers)[number]>();
  for (const answer of input.outcome.answers) {
    if (answers.has(answer.questionId)) {
      throw invalidRequest(`Duplicate answer for question: ${answer.questionId}`);
    }
    if (!questions.has(answer.questionId)) {
      throw invalidRequest(`Unknown question: ${answer.questionId}`);
    }
    answers.set(answer.questionId, answer);
  }

  for (const question of request.questions) {
    const answer = answers.get(question.questionId);
    if (!answer) throw invalidRequest(`Missing answer: ${question.questionId}`);
    if (answer.customText !== undefined) {
      if (answer.customText.trim().length === 0) {
        throw invalidRequest(`Custom answer cannot be blank: ${question.questionId}`);
      }
      if (answer.selectedOptionIds.length > 0) {
        throw invalidRequest(`Custom and structured answers are exclusive: ${question.questionId}`);
      }
      continue;
    }

    const selected = new Set(answer.selectedOptionIds);
    if (selected.size !== answer.selectedOptionIds.length) {
      throw invalidRequest(`Duplicate option in answer: ${question.questionId}`);
    }
    // An empty selection with no custom text is an explicit skip: the user submitted the
    // batch without answering this question, and adapters report it to the agent as unanswered.
    if (!question.multiSelect && selected.size > 1) {
      throw invalidRequest(`Invalid selection count for question: ${question.questionId}`);
    }
    const optionIds = new Set(question.options.map((option) => option.optionId));
    for (const optionId of selected) {
      if (!optionIds.has(optionId)) {
        throw invalidRequest(`Unknown option ${optionId} for question: ${question.questionId}`);
      }
    }
  }
}

function invalidRequest(message: string): RequestError {
  return new RequestError({ code: 'invalid_request', message });
}

export function userResolution(input: AskResponseInput): AskResolutionEvent {
  return input.type === 'permission-response'
    ? {
        type: 'permission-resolved',
        requestId: input.requestId,
        outcome: input.outcome,
        source: 'user',
      }
    : {
        type: 'question-resolved',
        requestId: input.requestId,
        outcome: input.outcome,
        source: 'user',
      };
}

export function sessionCancellation(request: AskEvent): AskResolutionEvent {
  return request.type === 'permission-request'
    ? {
        type: 'permission-resolved',
        requestId: request.requestId,
        outcome: { outcome: 'cancelled' },
        source: 'session',
      }
    : {
        type: 'question-resolved',
        requestId: request.requestId,
        outcome: { outcome: 'cancelled' },
        source: 'session',
      };
}
