import type { Account, AccountEndpoint, AccountProtocol, AgentKind } from '@linkcode/schema';
import { AccountProtocolSchema } from '@linkcode/schema';
import { never } from 'foxts/guard';
import type { EndpointService, ServiceVariant } from './catalog';
import { endpointServiceById } from './catalog';
import { fillTemplate, isTemplateFilled } from './template';

/**
 * Which endpoint an agent uses for a given account, derived from the adapters' real injection seams
 * (`packages/host/agent-adapter` `credential.ts` + native adapters, `packages/host/engine`
 * `translator.ts`). One table, no per-service special cases — a service is either served by a
 * variant the agent speaks or it is unavailable.
 *
 * - claude-code reads `ANTHROPIC_*` env, so it speaks Anthropic natively; an OpenAI-chat endpoint is
 *   reachable through the local aigateway translator, which needs a base URL AND a key.
 * - codex overrides the base URL of its built-in *Responses* provider. Chat Completions was removed
 *   from the CLI (`wire_api = "chat"` is a config-load error since 0.122), so responses is the only
 *   shape it can reach.
 * - opencode and pi route by provider: any wire works, but a provider the agent already knows ships
 *   the wire adapter and model metadata, so those variants are preferred.
 * - grok-build has no base-URL flag at all; only an xAI key reaches its endpoint.
 */

export type BindingTier = 'native' | 'translate' | 'unavailable';

export type BindingUnavailableReason =
  | 'oauth-other-agent'
  | 'protocol-unsupported'
  /** A templated endpoint whose `{placeholder}` values are missing from the account. */
  | 'endpoint-incomplete';

export type ResolvedBinding =
  | {
      tier: 'native' | 'translate';
      /** Absent when the account names no endpoint: an oauth login, or a pre-catalog bare key. */
      protocol?: AccountProtocol;
      baseUrl?: string;
      /** The endpoint's id in this agent's own provider catalog, when it has one. */
      knownProvider?: string;
    }
  | { tier: 'unavailable'; reason: BindingUnavailableReason };

/** Stable resolution order for agents that accept every wire. */
const PROTOCOL_ORDER = AccountProtocolSchema.options;

/** Whether (and how) this account can back sessions of the given agent, plus the endpoint to use. */
export function resolveBinding(account: Account, kind: AgentKind): ResolvedBinding {
  if (account.credential.type === 'oauth') {
    // An OAuth account is one CLI's login; it cannot back another agent.
    return account.credential.agent === kind
      ? { tier: 'native' }
      : { tier: 'unavailable', reason: 'oauth-other-agent' };
  }
  if (kind === 'grok-build') return resolveGrokBuild(account);

  const service = endpointServiceById(account.service);
  // An endpoint the user named themselves outranks the catalog. One the pre-variant add flow
  // derived from the catalog does not: honoring it would pin an existing account to a single
  // protocol forever, which is how an upgraded OpenAI account would lose codex.
  if (account.endpoint && !isCatalogDerived(account.endpoint, service)) {
    const { protocol, baseUrl } = account.endpoint;
    return bind(kind, protocol, baseUrl, knownProviderFor(service?.variants[protocol], kind));
  }
  if (!service) {
    // Vendor unknown (pre-catalog bare key): keep it bindable everywhere, matching the pre-catalog
    // behavior — the user knows which vendor the key belongs to.
    return { tier: 'native' };
  }
  return resolveService(service, account, kind);
}

/** Every protocol shape a service serves, for display. */
export function serviceProtocols(id: string | undefined): AccountProtocol[] {
  const service = endpointServiceById(id);
  if (!service) return [];
  return PROTOCOL_ORDER.filter((protocol) => service.variants[protocol] !== undefined);
}

function resolveGrokBuild(account: Account): ResolvedBinding {
  // The headless CLI has no base-URL flag: only the xAI catalog entry is known to target its
  // endpoint. Preserve pre-catalog bare keys, whose vendor was never recorded.
  const bare = account.service === undefined && account.endpoint === undefined;
  return bare || account.service === 'xai'
    ? { tier: 'native' }
    : { tier: 'unavailable', reason: 'protocol-unsupported' };
}

function resolveService(
  service: EndpointService,
  account: Account,
  kind: AgentKind,
): ResolvedBinding {
  for (const protocol of preferredProtocols(service, kind)) {
    const variant = service.variants[protocol];
    if (!variant) continue;
    const baseUrl = fillTemplate(variant.baseUrl, account.endpointParams ?? {});
    if (!isTemplateFilled(baseUrl)) return { tier: 'unavailable', reason: 'endpoint-incomplete' };
    return bind(kind, protocol, baseUrl, knownProviderFor(variant, kind));
  }
  return { tier: 'unavailable', reason: 'protocol-unsupported' };
}

/**
 * The protocols to try, most preferred first. claude-code and codex have one native shape each
 * (claude-code falling back to the translator); opencode and pi accept any, preferring a variant
 * their own catalog already knows.
 */
function preferredProtocols(service: EndpointService, kind: AgentKind): AccountProtocol[] {
  switch (kind) {
    case 'claude-code':
      return ['anthropic', 'openai-chat'];
    case 'codex':
      return ['openai-responses'];
    case 'opencode':
    case 'pi': {
      const known = PROTOCOL_ORDER.filter(
        (protocol) => service.variants[protocol]?.knownProvider?.[kind] !== undefined,
      );
      return [...known, ...PROTOCOL_ORDER.filter((protocol) => !known.includes(protocol))];
    }
    case 'grok-build':
      return [];
    default:
      return never(kind, 'agent kind');
  }
}

/** Tier for one concrete (agent, protocol) pair. */
function bind(
  kind: AgentKind,
  protocol: AccountProtocol,
  baseUrl: string,
  knownProvider: string | undefined,
): ResolvedBinding {
  const resolved = { protocol, baseUrl, ...(knownProvider !== undefined && { knownProvider }) };
  switch (kind) {
    case 'claude-code':
      if (protocol === 'anthropic') return { tier: 'native', ...resolved };
      // The sidecar implements only `openai-chat` (engine `TranslatorUpstream.wire`).
      return protocol === 'openai-chat'
        ? { tier: 'translate', ...resolved }
        : { tier: 'unavailable', reason: 'protocol-unsupported' };
    case 'codex':
      return protocol === 'openai-responses'
        ? { tier: 'native', ...resolved }
        : { tier: 'unavailable', reason: 'protocol-unsupported' };
    case 'opencode':
    case 'pi':
      return { tier: 'native', ...resolved };
    case 'grok-build':
      return { tier: 'unavailable', reason: 'protocol-unsupported' };
    default:
      return never(kind, 'agent kind');
  }
}

function knownProviderFor(
  variant: ServiceVariant | undefined,
  kind: AgentKind,
): string | undefined {
  return variant?.knownProvider?.[kind];
}

/**
 * Whether the catalog itself produces this endpoint for the account's service — i.e. whether the
 * pre-variant add flow wrote it, back when an account could only name one. Such an endpoint carries
 * no user intent, so per-agent resolution replaces it. A URL matching no variant was typed by the
 * user (a custom account, or a catalog account edited by hand) and is kept.
 */
function isCatalogDerived(
  endpoint: AccountEndpoint,
  service: EndpointService | undefined,
): boolean {
  return service?.variants[endpoint.protocol]?.baseUrl === endpoint.baseUrl;
}
