import type { Account, AccountProtocol, AgentKind } from '@linkcode/schema';
import { accountProtocol } from './catalog';

/**
 * Which accounts each agent can bind, derived from the adapters' real injection seams — the UI
 * hardcodes nothing. Facts as of 2026-07 (packages/agent-adapter `credential.ts` + native
 * adapters, packages/engine `translator.ts`):
 * - claude-code speaks Anthropic natively (`ANTHROPIC_*` env); an `openai-chat` endpoint is
 *   reachable through the local aigateway translator, which needs a base URL AND a key.
 * - codex reaches any OpenAI-shaped endpoint via `OPENAI_BASE_URL` + `CODEX_API_KEY`.
 * - opencode and pi: openai-chat is the verified path; an Anthropic endpoint plausibly works but
 *   is unverified against the SDK — flip it here once verified live.
 */
const AGENT_NATIVE_PROTOCOLS: Record<AgentKind, AccountProtocol[]> = {
  'claude-code': ['anthropic'],
  codex: ['openai-chat', 'openai-responses'],
  opencode: ['openai-chat'],
  pi: ['openai-chat'],
  // Grok Build headless CLI: OAuth uses ~/.grok/auth.json; openai-chat/xAI keys inject as XAI_API_KEY.
  'grok-build': ['openai-chat'],
};

/** Cross-protocol pairs the local translation sidecar serves (engine `translationUpstream`). */
const TRANSLATABLE: ReadonlyArray<{ agent: AgentKind; upstream: AccountProtocol }> = [
  { agent: 'claude-code', upstream: 'openai-chat' },
];

export type BindingTier = 'native' | 'translate' | 'unavailable';

export type BindingUnavailableReason =
  | 'oauth-other-agent'
  | 'protocol-unsupported'
  | 'translation-needs-endpoint';

export type BindingAvailability =
  | { tier: 'native' | 'translate' }
  | { tier: 'unavailable'; reason: BindingUnavailableReason };

/** Whether (and how) this account can back sessions of the given agent. */
export function bindingAvailability(account: Account, kind: AgentKind): BindingAvailability {
  if (account.credential.type === 'oauth') {
    // An OAuth account is one CLI's login; it cannot back another agent.
    return account.credential.agent === kind
      ? { tier: 'native' }
      : { tier: 'unavailable', reason: 'oauth-other-agent' };
  }
  const protocol = accountProtocol(account);
  // Unknown protocol (pre-catalog custom account without endpoint): keep it bindable everywhere,
  // matching the pre-catalog behavior — the user knows which vendor the bare key belongs to.
  if (protocol === undefined) return { tier: 'native' };
  if (AGENT_NATIVE_PROTOCOLS[kind].includes(protocol)) return { tier: 'native' };
  if (TRANSLATABLE.some((pair) => pair.agent === kind && pair.upstream === protocol)) {
    // The translator forwards to `baseUrl` with the account's key — both are required.
    return account.endpoint?.baseUrl
      ? { tier: 'translate' }
      : { tier: 'unavailable', reason: 'translation-needs-endpoint' };
  }
  return { tier: 'unavailable', reason: 'protocol-unsupported' };
}
