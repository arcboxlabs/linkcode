import type { AgentKind, AgentModelOption } from '@linkcode/schema';

/** Canned catalogs for agents whose model set is adapter-advertised (`available-models-update`).
 * Mirrors the opencode adapter's shape: `id` = `providerId/modelId`, `description` = provider
 * display name — the composer groups the picker by that subtitle. */
export const SEED_MODEL_CATALOGS: Partial<Record<AgentKind, AgentModelOption[]>> = {
  opencode: [
    { id: 'opencode/hy3-free', label: 'Hy3 Free', description: 'OpenCode Zen' },
    { id: 'opencode/big-pickle', label: 'Big Pickle', description: 'OpenCode Zen' },
    { id: 'opencode/mimo-v2.5-free', label: 'MiMo V2.5 Free', description: 'OpenCode Zen' },
    {
      id: 'opencode/deepseek-v4-flash-free',
      label: 'DeepSeek V4 Flash Free',
      description: 'OpenCode Zen',
    },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
    { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', description: 'OpenAI' },
    { id: 'openai/gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'OpenAI' },
    { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'OpenAI' },
    { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'OpenAI' },
    { id: 'anthropic/claude-fable-5', label: 'Claude Fable 5', description: 'Anthropic' },
    { id: 'anthropic/claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Anthropic' },
    { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Anthropic' },
    { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5', description: 'Anthropic' },
    { id: 'google/gemini-3.2-pro', label: 'Gemini 3.2 Pro', description: 'Google' },
    { id: 'google/gemini-3.2-flash', label: 'Gemini 3.2 Flash', description: 'Google' },
  ],
};
