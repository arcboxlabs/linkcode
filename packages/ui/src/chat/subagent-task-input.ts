export interface SubagentTaskInput {
  description?: string;
  subagentType?: string;
}

/** The Task tool's input fields the header displays (see the SDK's `AgentInput`). */
export function subagentTaskInput(rawInput: unknown): SubagentTaskInput {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return {};
  const raw = rawInput as Record<string, unknown>;
  return {
    description: typeof raw.description === 'string' ? raw.description : undefined,
    subagentType: typeof raw.subagent_type === 'string' ? raw.subagent_type : undefined,
  };
}
