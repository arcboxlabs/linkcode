import type { Account, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';

/** Pure view helpers for the Providers page — no hooks, unit-testable. */

export const AGENT_KINDS = AgentKindSchema.options;

/** The secret string a key/token account holds; undefined for oauth (LinkCode stores none). */
export function accountSecret(account: Account): string | undefined {
  if (account.credential.type === 'api-key') return account.credential.key;
  if (account.credential.type === 'auth-token') return account.credential.token;
  return undefined;
}

/** Tail-anchored mask: enough to recognize a key, never enough to reconstruct it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return '••••••••';
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

/** Agents whose active provider is this account, in stable agent order. */
export function boundAgentKinds(
  providers: ProvidersConfig | undefined,
  accountId: string,
): AgentKind[] {
  return AGENT_KINDS.filter((kind) => providers?.[kind]?.activeAccountId === accountId);
}

/** The `providers` slice this account writes into `~/.linkcode/config.json`, pretty-printed for
 * the detail pane preview. Contains no secret (the account itself holds the credential). */
export function accountConfigSnippet(
  providers: ProvidersConfig | undefined,
  accountId: string,
): string {
  const bound = boundAgentKinds(providers, accountId);
  const slice: Record<string, unknown> = {};
  for (const kind of bound) slice[kind] = providers?.[kind];
  return JSON.stringify({ providers: slice }, null, 2);
}

/** Bind (or, with undefined, unbind) an agent's active account; other fields survive untouched. */
export function withBinding(
  providers: ProvidersConfig,
  kind: AgentKind,
  accountId: string | undefined,
): ProvidersConfig {
  const entry = providers[kind] ?? { enabled: true };
  if (accountId === undefined) {
    const { activeAccountId: _cleared, ...rest } = entry;
    return { ...providers, [kind]: rest };
  }
  return { ...providers, [kind]: { ...entry, activeAccountId: accountId } };
}

/** Toggle whether the agent is offered in the client's agent picker. */
export function withEnabled(
  providers: ProvidersConfig,
  kind: AgentKind,
  enabled: boolean,
): ProvidersConfig {
  return { ...providers, [kind]: { ...(providers[kind] ?? {}), enabled } };
}

/** Set (or, with undefined, clear) an agent's default model. */
export function withModel(
  providers: ProvidersConfig,
  kind: AgentKind,
  model: string | undefined,
): ProvidersConfig {
  const entry = providers[kind] ?? { enabled: true };
  if (model === undefined) {
    const { defaultModel: _cleared, ...rest } = entry;
    return { ...providers, [kind]: rest };
  }
  return { ...providers, [kind]: { ...entry, defaultModel: model } };
}

/** Drop every binding referencing a removed account; returns the input unchanged when none did. */
export function withoutAccount(providers: ProvidersConfig, accountId: string): ProvidersConfig {
  let changed = false;
  const next: ProvidersConfig = {};
  for (const kind of AGENT_KINDS) {
    const entry = providers[kind];
    if (entry === undefined) continue;
    if (entry.activeAccountId === accountId) {
      const { activeAccountId: _cleared, ...rest } = entry;
      next[kind] = rest;
      changed = true;
    } else {
      next[kind] = entry;
    }
  }
  return changed ? next : providers;
}
