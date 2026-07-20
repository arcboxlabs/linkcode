import type { AccountCustomProvider, StartOptions } from '@linkcode/schema';
import type { PiSdk } from './history';

type PiRegistry = ReturnType<PiSdk['ModelRegistry']['create']>;
type PiProviderConfigInput = Parameters<PiRegistry['registerProvider']>[1];

/** The pi wire `api` each account endpoint protocol maps to; the account form collects only the
 * protocol, so a custom provider needs no separate api field. */
const PI_API_BY_PROTOCOL: Record<string, string> = {
  anthropic: 'anthropic-messages',
  'openai-chat': 'openai-completions',
  'openai-responses': 'openai-responses',
};

/**
 * The `registerProvider` input that turns an account-defined provider into a full registry
 * provider (models included — the SDK validates and replaces any same-name provider's models).
 * Null when the account lacks one of the pieces registration requires: endpoint URL, key, or a
 * protocol with a pi api mapping.
 */
export function customProviderRegistration(
  custom: AccountCustomProvider,
  config: StartOptions['config'],
  key: string | undefined,
  baseUrl: string | undefined,
): PiProviderConfigInput | null {
  const protocol = typeof config?.protocol === 'string' ? config.protocol : undefined;
  const api = protocol ? PI_API_BY_PROTOCOL[protocol] : undefined;
  if (!api || !key || !baseUrl) return null;
  return {
    baseUrl,
    apiKey: key,
    api,
    models: custom.models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.thinkingLevelMap && { thinkingLevelMap: model.thinkingLevelMap }),
    })),
  };
}
