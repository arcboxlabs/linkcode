import {
  accountEnabledFor,
  pinnedEndpoint,
  resolveBinding,
  serviceById,
  serviceProtocols,
} from '@linkcode/providers';
import type {
  Account,
  Accounts,
  AgentKind,
  AgentRuntimes,
  ProvidersConfig,
} from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import type {
  ProviderAccountDetailViewModel,
  ProviderAccountListItem,
  ProviderAccountListViewModel,
  ProviderAccountRouting,
  ProviderAgentStatus,
  ProviderAgentViewModel,
  ProviderCredentialViewModel,
} from '@linkcode/ui';

/** Pure view helpers for the Providers page — no hooks, unit-testable. */

export const AGENT_KINDS = AgentKindSchema.options;

/** Tail-anchored mask: enough to recognize a key, never enough to reconstruct it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return '••••••••';
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

/** Agents whose pickers offer this account's models, in stable agent order. Enablement alone is not
 * enough — an absent list enables every agent, including the ones this account cannot back. */
export function boundAgentKinds(
  account: Account,
  providers: ProvidersConfig | undefined,
): AgentKind[] {
  return AGENT_KINDS.filter(
    (kind) =>
      resolveBinding(account, kind).tier !== 'unavailable' &&
      accountEnabledFor(providers, kind, account.id),
  );
}

/** The `providers` slice this account writes into `~/.linkcode/config.json`, pretty-printed for
 * the detail pane preview. Contains no secret (the account itself holds the credential). */
export function accountConfigSnippet(
  account: Account,
  providers: ProvidersConfig | undefined,
): string {
  const bound = boundAgentKinds(account, providers);
  const slice: Record<string, unknown> = {};
  for (const kind of bound) slice[kind] = providers?.[kind];
  return JSON.stringify({ providers: slice }, null, 2);
}

function oauthDetails(account: Account, runtimes: AgentRuntimes | undefined): string[] {
  if (account.credential.type !== 'oauth') return [];
  const auth = runtimes?.[account.credential.agent]?.auth;
  if (auth?.loggedIn !== true) return [];
  return [auth.email, auth.method, auth.subscriptionType].filter((detail): detail is string =>
    Boolean(detail),
  );
}

function credentialViewModel(
  account: Account,
  runtimes: AgentRuntimes | undefined,
): ProviderCredentialViewModel {
  if (account.credential.type === 'oauth') {
    const auth = runtimes?.[account.credential.agent]?.auth;
    return {
      kind: 'oauth',
      agent: account.credential.agent,
      ...(!(auth === undefined) && {
        auth: { loggedIn: auth.loggedIn, details: oauthDetails(account, runtimes) },
      }),
    };
  }
  const value =
    account.credential.type === 'api-key' ? account.credential.key : account.credential.token;
  return {
    kind: 'secret',
    type: account.credential.type,
    value,
    maskedValue: maskSecret(value),
  };
}

function agentStatus(
  account: Account,
  kind: AgentKind,
  providers: ProvidersConfig | undefined,
): Omit<ProviderAgentViewModel, 'kind'> {
  const availability = resolveBinding(account, kind);
  if (availability.tier === 'unavailable') {
    const status: ProviderAgentStatus =
      availability.reason === 'oauth-other-agent' && account.credential.type === 'oauth'
        ? { kind: 'unavailable-oauth', agent: account.credential.agent }
        : {
            kind:
              availability.reason === 'endpoint-incomplete'
                ? 'unavailable-endpoint-incomplete'
                : 'unavailable-protocol',
          };
    return { tier: availability.tier, enabled: false, status };
  }
  // Enabled is the whole state, and the switch already shows it — only a reason to be off earns text.
  const enabled = accountEnabledFor(providers, kind, account.id);
  return {
    tier: availability.tier,
    enabled,
    ...(!enabled && { status: { kind: 'disabled' } }),
  };
}

/** Selected account plus precomputed binding rows; UI owns only rendering and local interaction. */
export function providerAccountDetailViewModel(
  account: Account,
  providers: ProvidersConfig | undefined,
  runtimes: AgentRuntimes | undefined,
): ProviderAccountDetailViewModel {
  const agents = AGENT_KINDS.map(
    (kind): ProviderAgentViewModel => ({ kind, ...agentStatus(account, kind, providers) }),
  );
  const boundAgents = boundAgentKinds(account, providers);
  const serviceLabel = serviceById(account.service)?.label;
  const routing = accountRouting(account);
  return {
    id: account.id,
    label: account.label,
    credential: credentialViewModel(account, runtimes),
    agents,
    boundAgents,
    enabledAgentCount: agents.filter((agent) => agent.enabled).length,
    availableAgentCount: agents.filter((agent) => agent.tier !== 'unavailable').length,
    ...(!(account.service === undefined) && { service: account.service }),
    ...(!(serviceLabel === undefined) && { serviceLabel }),
    ...(routing !== undefined && { routing }),
    ...(account.models !== undefined && {
      accountModels: account.models.map(({ id, label }) => ({ id, label: label ?? id })),
    }),
    ...(!(boundAgents.length === 0) && {
      configPreview: accountConfigSnippet(account, providers),
    }),
  };
}

/**
 * How this account reaches its provider, as the one axis the UI renders. A catalog account has no
 * single endpoint — each agent resolves its own — so it advertises the shapes the service serves;
 * only a user-named endpoint is a pin. Asking the resolver keeps this answer identical to the one
 * a session start will act on.
 */
function accountRouting(account: Account): ProviderAccountRouting | undefined {
  const pinned = pinnedEndpoint(account);
  if (pinned) return { kind: 'pinned', baseUrl: pinned.baseUrl, protocol: pinned.protocol };
  const protocols = serviceProtocols(account.service);
  return protocols.length > 0 ? { kind: 'catalog', protocols } : undefined;
}

function providerAccountListItem(
  account: Account,
  providers: ProvidersConfig | undefined,
  runtimes: AgentRuntimes | undefined,
): ProviderAccountListItem {
  const serviceLabel = serviceById(account.service)?.label;
  const routing = accountRouting(account);
  const auth =
    account.credential.type === 'oauth' ? runtimes?.[account.credential.agent]?.auth : undefined;
  return {
    id: account.id,
    label: account.label,
    credentialType: account.credential.type,
    boundAgents: boundAgentKinds(account, providers),
    ...(account.service !== undefined && { service: account.service }),
    ...(serviceLabel !== undefined && { serviceLabel }),
    ...(routing !== undefined && { routing }),
    ...(auth !== undefined && {
      auth: {
        loggedIn: auth.loggedIn,
        ...(auth.email !== undefined && { email: auth.email }),
      },
    }),
  };
}

/** Precomputed account rows for the presentation-only list. */
export function providerAccountListViewModel(
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  runtimes: AgentRuntimes | undefined,
): ProviderAccountListViewModel {
  return {
    accounts: accounts.map((account) => providerAccountListItem(account, providers, runtimes)),
  };
}

/**
 * Show or hide one account's models in an agent's pickers. Absent `enabledAccountIds` means every
 * bindable account, so the first disable has to materialize the list from what is bindable *now* —
 * otherwise hiding one account would read as "only this one", hiding every other account too. Once
 * the list exists it is authoritative, so an account added later stays out until enabled.
 */
export function withAccountEnabled(
  providers: ProvidersConfig,
  kind: AgentKind,
  accountId: string,
  enabled: boolean,
  accounts: Accounts = [],
): ProvidersConfig {
  const entry = providers[kind] ?? { enabled: true };
  const current =
    entry.enabledAccountIds ??
    accounts.reduce<string[]>((ids, account) => {
      if (resolveBinding(account, kind).tier !== 'unavailable') ids.push(account.id);
      return ids;
    }, []);
  const next = enabled
    ? [...new Set([...current, accountId])]
    : current.filter((id) => id !== accountId);
  return { ...providers, [kind]: { ...entry, enabledAccountIds: next } };
}

/** Toggle whether the agent is offered in the client's agent picker. */
export function withEnabled(
  providers: ProvidersConfig,
  kind: AgentKind,
  enabled: boolean,
): ProvidersConfig {
  return { ...providers, [kind]: { ...providers[kind], enabled } };
}

/** Drop a removed account from every enabled list; returns the input unchanged when none named it.
 * An agent left with an absent list would silently re-offer every bindable account, so a list that
 * loses its last entry stays present and empty. */
export function withoutAccount(providers: ProvidersConfig, accountId: string): ProvidersConfig {
  let changed = false;
  const next: ProvidersConfig = {};
  for (const kind of AGENT_KINDS) {
    const entry = providers[kind];
    if (entry === undefined) continue;
    if (entry.enabledAccountIds?.includes(accountId)) {
      next[kind] = {
        ...entry,
        enabledAccountIds: entry.enabledAccountIds.filter((id) => id !== accountId),
      };
      changed = true;
    } else {
      next[kind] = entry;
    }
  }
  return changed ? next : providers;
}
