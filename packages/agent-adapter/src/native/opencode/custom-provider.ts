import type { AccountCustomProvider, StartOptions } from '@linkcode/schema';

/** The AI SDK package opencode should load for each account endpoint protocol. */
const NPM_BY_PROTOCOL: Record<string, string> = {
  'openai-chat': '@ai-sdk/openai-compatible',
  'openai-responses': '@ai-sdk/openai',
  anthropic: '@ai-sdk/anthropic',
};

/**
 * The `config.provider[name]` block that turns an account-defined provider (CODE-312) into a full
 * opencode provider at spawn — the same shape a user would write in opencode.json. pi-only
 * knowledge (`thinkingLevelMap`) has no opencode counterpart and is dropped; LinkCode exposes no
 * opencode effort axis, so nothing is lost functionally.
 */
export function opencodeCustomProviderConfig(
  custom: AccountCustomProvider,
  config: StartOptions['config'],
  key: string | undefined,
  baseUrl: string | undefined,
): Record<string, unknown> | null {
  const protocol = typeof config?.protocol === 'string' ? config.protocol : undefined;
  const npm = protocol ? NPM_BY_PROTOCOL[protocol] : undefined;
  if (!npm || !key || !baseUrl) return null;
  return {
    npm,
    name: custom.name,
    options: { baseURL: baseUrl, apiKey: key },
    models: Object.fromEntries(
      custom.models.map((model) => [
        model.id,
        {
          name: model.name ?? model.id,
          reasoning: model.reasoning,
          limit: { context: model.contextWindow, output: model.maxTokens },
          ...(model.input.includes('image') && {
            modalities: { input: model.input, output: ['text'] },
          }),
          cost: {
            input: model.cost.input,
            output: model.cost.output,
            cache_read: model.cost.cacheRead,
            cache_write: model.cost.cacheWrite,
          },
        },
      ]),
    ),
  };
}
