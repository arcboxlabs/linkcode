import type {
  Account,
  AccountProtocol,
  Accounts,
  AgentAuthStatus,
  AgentKind,
  AgentRuntimes,
} from '@linkcode/schema';

/**
 * The service directory behind the add-account flow, as pure data (no hooks); selecting an entry
 * seeds the form so the user only pastes a secret. Endpoint facts verified against vendor docs
 * (2026-07); a `{placeholder}` in a URL becomes a dedicated form field. The entry's `id` is
 * persisted as `Account.service`.
 */

/** Grouping in the add-account catalog grid. */
export type ServiceGroup = 'subscription' | 'direct' | 'gateway' | 'custom';

/** One endpoint shape a service offers; dual-shape gateways expose one variant per protocol. */
export interface ServiceVariant {
  id: 'openai' | 'anthropic' | 'default';
  protocol: AccountProtocol;
  /** Endpoint URL, possibly templated with `{placeholder}` segments. */
  baseUrl: string;
  /** How the endpoint authenticates: bearer token (`auth-token`) or `x-api-key` (`api-key`). */
  credentialType: 'api-key' | 'auth-token';
}

export type ServiceDescriptor =
  /** Delegates to an agent CLI's own login store — no secret handled by LinkCode. */
  | { id: string; label: string; group: 'subscription'; kind: 'oauth'; agent: AgentKind }
  /** Key/token against a baked endpoint (direct vendor API or gateway). */
  | {
      id: string;
      label: string;
      group: ServiceGroup;
      kind: 'endpoint';
      variants: ServiceVariant[];
      secretPlaceholder?: string;
    }
  /** Free-form endpoint — the full account form. */
  | { id: 'custom'; label: string; group: 'custom'; kind: 'custom' };

export const SERVICE_CATALOG: ServiceDescriptor[] = [
  { id: 'claude-sub', label: 'Claude', group: 'subscription', kind: 'oauth', agent: 'claude-code' },
  { id: 'chatgpt-sub', label: 'ChatGPT', group: 'subscription', kind: 'oauth', agent: 'codex' },
  {
    id: 'anthropic-api',
    label: 'Anthropic API',
    group: 'direct',
    kind: 'endpoint',
    variants: [
      {
        id: 'default',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        credentialType: 'api-key',
      },
    ],
    secretPlaceholder: 'sk-ant-…',
  },
  {
    id: 'openai-api',
    label: 'OpenAI API',
    group: 'direct',
    kind: 'endpoint',
    variants: [
      {
        id: 'default',
        protocol: 'openai-chat',
        baseUrl: 'https://api.openai.com/v1',
        credentialType: 'api-key',
      },
    ],
    secretPlaceholder: 'sk-…',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    group: 'direct',
    kind: 'endpoint',
    variants: [
      {
        id: 'default',
        protocol: 'openai-chat',
        baseUrl: 'https://api.x.ai/v1',
        credentialType: 'api-key',
      },
    ],
    secretPlaceholder: 'xai-…',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    group: 'gateway',
    kind: 'endpoint',
    variants: [
      {
        id: 'openai',
        protocol: 'openai-chat',
        baseUrl: 'https://openrouter.ai/api/v1',
        credentialType: 'auth-token',
      },
      {
        // The "Anthropic skin" is guaranteed only for Claude models.
        id: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://openrouter.ai/api',
        credentialType: 'auth-token',
      },
    ],
    secretPlaceholder: 'sk-or-v1-…',
  },
  {
    id: 'vercel-gateway',
    label: 'Vercel AI Gateway',
    group: 'gateway',
    kind: 'endpoint',
    variants: [
      {
        id: 'openai',
        protocol: 'openai-chat',
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        credentialType: 'auth-token',
      },
      {
        // Anthropic-shaped endpoint; translates server-side, so it also serves non-Anthropic models.
        id: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://ai-gateway.vercel.sh',
        credentialType: 'auth-token',
      },
    ],
  },
  {
    id: 'cloudflare-gateway',
    label: 'Cloudflare AI Gateway',
    group: 'gateway',
    kind: 'endpoint',
    variants: [
      {
        id: 'openai',
        protocol: 'openai-chat',
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat',
        credentialType: 'auth-token',
      },
      {
        // Pass-through: needs a real Anthropic key.
        id: 'anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic',
        credentialType: 'api-key',
      },
    ],
  },
  { id: 'custom', label: 'Custom', group: 'custom', kind: 'custom' },
];

export function serviceById(id: string | undefined): ServiceDescriptor | undefined {
  return id === undefined ? undefined : SERVICE_CATALOG.find((service) => service.id === id);
}

const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g;

/** Account-specific `{placeholder}` fields a templated endpoint URL needs filled. */
export function templatePlaceholders(baseUrl: string): string[] {
  return [...baseUrl.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

export function fillTemplate(baseUrl: string, values: Record<string, string>): string {
  return baseUrl.replaceAll(PLACEHOLDER_PATTERN, (whole, key: string) => values[key] ?? whole);
}

export interface DetectedLoginSuggestion {
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>;
  auth: AgentAuthStatus;
}

/**
 * CLI logins the runtime probe sees that the pool does not represent yet, offered as one-click
 * "detected" cards: `loggedIn: true` with no oauth account for that agent. The pool stays
 * explicit user state — this is a suggestion, not an implicit member.
 */
export function detectedLoginSuggestions(
  accounts: Accounts,
  runtimes: AgentRuntimes | undefined,
): DetectedLoginSuggestion[] {
  const suggestions: DetectedLoginSuggestion[] = [];
  for (const service of SERVICE_CATALOG) {
    if (service.kind !== 'oauth') continue;
    const auth = runtimes?.[service.agent]?.auth;
    if (auth?.loggedIn !== true) continue;
    const represented = accounts.some(
      (account) =>
        account.credential.type === 'oauth' && account.credential.agent === service.agent,
    );
    if (!represented) suggestions.push({ service, auth });
  }
  return suggestions;
}

/**
 * The protocol an account's requests speak: the explicit endpoint protocol, or the one its
 * service implies. Undefined for pre-catalog custom accounts with no endpoint — compatibility is
 * unknown, so the UI keeps them bindable everywhere.
 */
export function accountProtocol(account: Account): AccountProtocol | undefined {
  if (account.endpoint) return account.endpoint.protocol;
  const service = serviceById(account.service);
  if (service?.kind !== 'endpoint') return undefined;
  const protocols = new Set(service.variants.map((variant) => variant.protocol));
  return protocols.size === 1 ? service.variants[0].protocol : undefined;
}
