export type ConversationPromptTone = 'neutral' | 'warning' | 'danger';

export type ConversationPromptMode = 'single' | 'multiple';

export interface ConversationPromptChoice {
  id: string;
  label: string;
  description?: string;
  tone?: ConversationPromptTone;
}

export interface ConversationPromptResponse {
  selectedIds: string[];
  customText?: string;
}

export interface ConversationPromptDefinition {
  mode: ConversationPromptMode;
  choices: readonly ConversationPromptChoice[];
}

export function isConversationPromptResponseSubmittable(
  prompt: ConversationPromptDefinition,
  response: ConversationPromptResponse,
): boolean {
  if (response.customText?.trim()) return true;
  if (prompt.choices.length === 0) return false;

  const selected = response.selectedIds.filter((id) =>
    prompt.choices.some((choice) => choice.id === id),
  );
  if (prompt.mode === 'multiple') return selected.length > 0;
  return selected.length === 1;
}

// TODO(backend): replace with prompts emitted by an agent-question event once the schema carries
// question text, answer mode, choices, and reply correlation.
export const STUB_AGENT_QUESTION_PROMPTS: ConversationPromptDefinition[] = [];

// TODO(backend): replace with prompts emitted by a plan-review permission event once plans can ask
// for explicit user approval before execution.
export const STUB_PLAN_REVIEW_PROMPTS: ConversationPromptDefinition[] = [];
