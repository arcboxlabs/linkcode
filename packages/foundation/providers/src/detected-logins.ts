import type { Accounts, AgentAuthStatus, AgentRuntimes } from '@linkcode/schema';
import type { ServiceDescriptor } from './catalog';
import { SERVICE_CATALOG } from './catalog';

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
