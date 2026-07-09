import type { AccountProtocol } from '@linkcode/schema';

/**
 * Known gateway / relay endpoints offered in the add-account flow. Selecting one seeds the endpoint
 * URL + protocol + credential type so the user only pastes a token. Pure data (no hooks) so it stays
 * importable anywhere. Endpoint facts verified against each vendor's docs (2026-07); a `{placeholder}`
 * in a URL is account-specific and must be filled in by the user.
 */
export interface AccountPreset {
  id: string;
  label: string;
  baseUrl: string;
  protocol: AccountProtocol;
  /** How the gateway authenticates: bearer token (`auth-token`) or `x-api-key` (`api-key`). */
  credentialType: 'api-key' | 'auth-token';
}

export const ACCOUNT_PRESETS: AccountPreset[] = [
  {
    // Anthropic-shaped endpoint; translates server-side, so it also backs non-Anthropic models.
    id: 'vercel-anthropic',
    label: 'Vercel AI Gateway · Anthropic',
    baseUrl: 'https://ai-gateway.vercel.sh',
    protocol: 'anthropic',
    credentialType: 'auth-token',
  },
  {
    id: 'vercel-openai',
    label: 'Vercel AI Gateway · OpenAI',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    protocol: 'openai-chat',
    credentialType: 'auth-token',
  },
  {
    // The "Anthropic skin" is guaranteed only for Claude models; other models need the OpenAI path.
    id: 'openrouter-anthropic',
    label: 'OpenRouter · Anthropic (Claude only)',
    baseUrl: 'https://openrouter.ai/api',
    protocol: 'anthropic',
    credentialType: 'auth-token',
  },
  {
    id: 'openrouter-openai',
    label: 'OpenRouter · OpenAI',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai-chat',
    credentialType: 'auth-token',
  },
  {
    // Pass-through: needs a real Anthropic key. Fill {account_id}/{gateway_id} from your CF dashboard.
    id: 'cloudflare-anthropic',
    label: 'Cloudflare AI Gateway · Anthropic',
    baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic',
    protocol: 'anthropic',
    credentialType: 'api-key',
  },
  {
    id: 'cloudflare-openai',
    label: 'Cloudflare AI Gateway · OpenAI',
    baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat',
    protocol: 'openai-chat',
    credentialType: 'auth-token',
  },
];
