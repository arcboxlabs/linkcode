import type { Accounts, AgentAuthStatus, AgentRuntimes } from '@linkcode/schema';
import type { ServiceDescriptor } from './catalog';
import { SERVICE_CATALOG } from './catalog';

export interface DetectedLogin {
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>;
  auth: AgentAuthStatus;
}

/**
 * CLI logins the runtime probe sees that the pool does not represent yet: `loggedIn: true` with no
 * oauth account for that agent. The host adopts each one into the pool, so a delegated subscription
 * reaches the model pickers on the same footing as a key the user typed.
 */
export function detectedLogins(
  accounts: Accounts,
  runtimes: AgentRuntimes | undefined,
): DetectedLogin[] {
  const suggestions: DetectedLogin[] = [];
  for (let i = 0, len = SERVICE_CATALOG.length; i < len; i++) {
    const service = SERVICE_CATALOG[i];
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
