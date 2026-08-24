import type { AccountProtocol, AgentKind } from '@linkcode/schema';

/**
 * The service directory: which endpoints each provider serves, and which of them the coding agents
 * already know by name. Read by the daemon (to resolve a session's endpoint) and by the client (to
 * render binding availability) — endpoint facts verified against vendor docs, `knownProvider` ids
 * against models.dev (opencode's catalog) and pi's `KnownProvider` union, 2026-08.
 *
 * A **variant** is one protocol shape of one service, reached with the *same* secret. Endpoints that
 * need a different secret, or that mean something different to the user (a plan/reasoning tier
 * versus the standard API), are separate services. Variants are never user-selectable — `resolve.ts`
 * picks one per agent.
 */

/** Grouping in the add-account catalog grid. */
export type ServiceGroup = 'subscription' | 'direct' | 'gateway' | 'custom';

export interface ServiceVariant {
  /** Endpoint URL, possibly templated with `{placeholder}` segments filled from `endpointParams`. */
  baseUrl: string;
  /** Ids for this endpoint in an agent's own provider catalog. Present means the agent already
   * carries the wire adapter and model metadata, so it needs only the key injected. */
  knownProvider?: Partial<Record<AgentKind, string>>;
}

/**
 * Where to read the ids this service serves. Service-level, not per variant: one secret reaches one
 * model list, and the ids are the same whichever protocol shape an agent ends up using.
 *
 * The URL is spelled out rather than derived from a variant's `baseUrl` + protocol, because
 * derivation is wrong for any service whose variants sit on different paths — DeepSeek's
 * `/anthropic` variant would yield `/anthropic/v1/models`, and Vercel's bare-origin one a root
 * `/models`. Absent means the service serves no list and the account is freeform-only.
 */
export interface ServiceModelList {
  url: string;
  /** Decides auth header and response shape only; the chat/responses split is irrelevant here. */
  wire: 'anthropic' | 'openai';
}

export type ServiceDescriptor =
  /** Delegates to an agent CLI's own login store — no secret handled by LinkCode. */
  | { id: string; label: string; group: 'subscription'; kind: 'oauth'; agent: AgentKind }
  /** Key/token against baked endpoints (direct vendor API or gateway). */
  | {
      id: string;
      label: string;
      group: ServiceGroup;
      kind: 'endpoint';
      /** How the one secret authenticates. Service-level: every variant accepts the same secret. */
      credentialType: 'api-key' | 'auth-token';
      variants: Partial<Record<AccountProtocol, ServiceVariant>>;
      models?: ServiceModelList;
      secretPlaceholder?: string;
    }
  /** Free-form endpoint — the full account form. */
  | { id: 'custom'; label: string; group: 'custom'; kind: 'custom' };

export const LINKCODE_GATEWAY_SERVICE_ID = 'linkcode-gateway';

export const SERVICE_CATALOG: ServiceDescriptor[] = [
  { id: 'claude-sub', label: 'Claude', group: 'subscription', kind: 'oauth', agent: 'claude-code' },
  { id: 'chatgpt-sub', label: 'ChatGPT', group: 'subscription', kind: 'oauth', agent: 'codex' },
  {
    id: 'anthropic-api',
    label: 'Anthropic API',
    group: 'direct',
    kind: 'endpoint',
    credentialType: 'api-key',
    variants: {
      anthropic: {
        baseUrl: 'https://api.anthropic.com',
        knownProvider: { opencode: 'anthropic', pi: 'anthropic' },
      },
    },
    // `limit` defaults to 20, so it must be asked for explicitly to get the whole list.
    models: { url: 'https://api.anthropic.com/v1/models?limit=1000', wire: 'anthropic' },
    secretPlaceholder: 'sk-ant-…',
  },
  {
    id: 'openai-api',
    label: 'OpenAI API',
    group: 'direct',
    kind: 'endpoint',
    credentialType: 'api-key',
    variants: {
      'openai-responses': {
        baseUrl: 'https://api.openai.com/v1',
        knownProvider: { opencode: 'openai', pi: 'openai' },
      },
      // Same endpoint, legacy shape. No known provider: opencode's and pi's `openai` entries both
      // resolve to the Responses adapter, so reaching chat here needs a custom registration.
      'openai-chat': { baseUrl: 'https://api.openai.com/v1' },
    },
    models: { url: 'https://api.openai.com/v1/models', wire: 'openai' },
    secretPlaceholder: 'sk-…',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    group: 'direct',
    kind: 'endpoint',
    credentialType: 'api-key',
    variants: {
      'openai-chat': {
        baseUrl: 'https://api.x.ai/v1',
        knownProvider: { opencode: 'xai', pi: 'xai' },
      },
      // Same endpoint, Responses shape — the only one codex speaks. No known provider: the agents'
      // own `xai` entries are chat-shaped, and opencode/pi prefer those.
      'openai-responses': { baseUrl: 'https://api.x.ai/v1' },
    },
    models: { url: 'https://api.x.ai/v1/models', wire: 'openai' },
    secretPlaceholder: 'xai-…',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    group: 'direct',
    kind: 'endpoint',
    credentialType: 'api-key',
    variants: {
      // Claude model names are remapped server-side (opus → v4-pro, sonnet/haiku → v4-flash).
      anthropic: { baseUrl: 'https://api.deepseek.com/anthropic' },
      // Responses serves `deepseek-v4-flash` only; v4-pro is still unsupported there (2026-08).
      'openai-responses': { baseUrl: 'https://api.deepseek.com' },
      'openai-chat': {
        baseUrl: 'https://api.deepseek.com',
        knownProvider: { opencode: 'deepseek', pi: 'deepseek' },
      },
    },
    // Service root, not the `/anthropic` variant's path — that one serves no list.
    models: { url: 'https://api.deepseek.com/models', wire: 'openai' },
    secretPlaceholder: 'sk-…',
  },
  {
    id: 'stepfun',
    label: 'StepFun',
    group: 'direct',
    kind: 'endpoint',
    credentialType: 'api-key',
    variants: {
      anthropic: { baseUrl: 'https://api.stepfun.com' },
      // Responses serves `step-3.7-flash` only (2026-08).
      'openai-responses': { baseUrl: 'https://api.stepfun.com/v1' },
      'openai-chat': {
        baseUrl: 'https://api.stepfun.com/v1',
        knownProvider: { opencode: 'stepfun' },
      },
    },
    models: { url: 'https://api.stepfun.com/v1/models', wire: 'openai' },
    secretPlaceholder: 'sk-…',
  },
  {
    id: LINKCODE_GATEWAY_SERVICE_ID,
    label: 'LinkCode Gateway',
    group: 'gateway',
    kind: 'endpoint',
    credentialType: 'auth-token',
    variants: {
      'openai-chat': { baseUrl: 'https://gateway.linkcode.ai/v1' },
      'openai-responses': { baseUrl: 'https://gateway.linkcode.ai/v1' },
    },
    models: { url: 'https://gateway.linkcode.ai/v1/models', wire: 'openai' },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    group: 'gateway',
    kind: 'endpoint',
    credentialType: 'auth-token',
    variants: {
      'openai-chat': {
        baseUrl: 'https://openrouter.ai/api/v1',
        knownProvider: { opencode: 'openrouter', pi: 'openrouter' },
      },
      'openai-responses': { baseUrl: 'https://openrouter.ai/api/v1' },
      // The "Anthropic skin" is guaranteed only for Claude models.
      anthropic: { baseUrl: 'https://openrouter.ai/api' },
    },
    models: { url: 'https://openrouter.ai/api/v1/models', wire: 'openai' },
    secretPlaceholder: 'sk-or-v1-…',
  },
  {
    id: 'vercel-gateway',
    label: 'Vercel AI Gateway',
    group: 'gateway',
    kind: 'endpoint',
    credentialType: 'auth-token',
    variants: {
      'openai-chat': {
        baseUrl: 'https://ai-gateway.vercel.sh/v1',
        knownProvider: { opencode: 'vercel', pi: 'vercel-ai-gateway' },
      },
      'openai-responses': { baseUrl: 'https://ai-gateway.vercel.sh/v1' },
      // Anthropic-shaped endpoint; translates server-side, so it also serves non-Anthropic models.
      anthropic: { baseUrl: 'https://ai-gateway.vercel.sh' },
    },
    models: { url: 'https://ai-gateway.vercel.sh/v1/models', wire: 'openai' },
  },
  {
    id: 'cloudflare-gateway',
    label: 'Cloudflare AI Gateway',
    group: 'gateway',
    kind: 'endpoint',
    credentialType: 'auth-token',
    // No `models`: `/compat` has no model-list route at all (docs + verified live), so a Cloudflare
    // gateway account is freeform-only.
    variants: {
      // `/compat` serves chat completions only — Cloudflare's Responses route is a different path
      // (`/openai/responses`), so there is deliberately no responses variant here.
      'openai-chat': {
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat',
        knownProvider: { opencode: 'cloudflare-ai-gateway', pi: 'cloudflare-ai-gateway' },
      },
    },
  },
  {
    // Its own service, not a variant of the gateway above: pass-through authenticates with the
    // user's real Anthropic key, so the two cannot share one stored secret.
    id: 'cloudflare-anthropic',
    label: 'Cloudflare AI Gateway (Anthropic)',
    group: 'gateway',
    kind: 'endpoint',
    credentialType: 'api-key',
    variants: {
      anthropic: {
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic',
      },
    },
    secretPlaceholder: 'sk-ant-…',
  },
  { id: 'custom', label: 'Custom', group: 'custom', kind: 'custom' },
];

export function serviceById(id: string | undefined): ServiceDescriptor | undefined {
  return id === undefined ? undefined : SERVICE_CATALOG.find((service) => service.id === id);
}

export type EndpointService = Extract<ServiceDescriptor, { kind: 'endpoint' }>;

export function endpointServiceById(id: string | undefined): EndpointService | undefined {
  const service = serviceById(id);
  return service?.kind === 'endpoint' ? service : undefined;
}

/** Where to read this service's model ids, or undefined when it serves no list. */
export function modelListSource(id: string | undefined): ServiceModelList | undefined {
  return endpointServiceById(id)?.models;
}
