import {
  detectedLoginSuggestions,
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
import { accountEnabledFor } from './default-models';

/** Pure view helpers for the Providers page — no hooks, unit-testable. */

export const AGENT_KINDS = AgentKindSchema.options;

/** Tail-anchored mask: enough to recognize a key, never enough to reconstruct it. */
export function maskSecret(secret: string): string {
  if (secret.length <= 12) return '••••••••';
  return `${secret.slice(0, 6)}…${secret.slice(-4)}`;
}

/** Agents that fall back to this account when nothing names one, in stable agent order. */
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
  accountLabels: ReadonlyMap<string, string>,
  kind: AgentKind,
  providers: ProvidersConfig | undefined,
): Omit<ProviderAgentViewModel, 'kind' | 'defaultModel'> {
  const availability = resolveBinding(account, kind);
  const defaultId = providers?.[kind]?.activeAccountId;
  const isDefault = defaultId === account.id;
  const enabled = accountEnabledFor(providers, kind, account.id);
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
    return { tier: availability.tier, enabled: false, isDefault: false, status };
  }
  return {
    tier: availability.tier,
    enabled,
    isDefault,
    status: !enabled
      ? { kind: 'disabled' }
      : isDefault
        ? { kind: 'default' }
        : defaultId === undefined
          ? { kind: 'enabled-no-default' }
          : { kind: 'enabled', defaultLabel: accountLabels.get(defaultId) ?? defaultId },
  };
}

/** Selected account plus precomputed binding rows; UI owns only rendering and local interaction. */
export function providerAccountDetailViewModel(
  account: Account,
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  runtimes: AgentRuntimes | undefined,
): ProviderAccountDetailViewModel {
  const accountLabels = new Map(accounts.map((candidate) => [candidate.id, candidate.label]));
  const agents = AGENT_KINDS.map((kind): ProviderAgentViewModel => {
    const status = agentStatus(account, accountLabels, kind, providers);
    // Only the default account's row edits the default model — the pick belongs to that pairing.
    return {
      kind,
      ...status,
      ...(status.isDefault && { defaultModel: providers?.[kind]?.model ?? '' }),
    };
  });
  const boundAgents = boundAgentKinds(providers, account.id);
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
      configPreview: accountConfigSnippet(providers, account.id),
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
    boundAgents: boundAgentKinds(providers, account.id),
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

/** Precomputed account rows and detected-login suggestions for the presentation-only list. */
export function providerAccountListViewModel(
  accounts: Accounts,
  providers: ProvidersConfig | undefined,
  runtimes: AgentRuntimes | undefined,
): ProviderAccountListViewModel {
  return {
    accounts: accounts.map((account) => providerAccountListItem(account, providers, runtimes)),
    detectedLogins: detectedLoginSuggestions(accounts, runtimes).map(({ service, auth }) => ({
      service: service.id,
      label: service.label,
      ...(auth.email !== undefined && { email: auth.email }),
    })),
    bindingCount: AGENT_KINDS.filter((kind) => providers?.[kind]?.activeAccountId !== undefined)
      .length,
    agentCount: AGENT_KINDS.length,
  };
}

/**
 * Set (or, with undefined, clear) the account an agent falls back to when nothing names one. Other
 * fields survive untouched — with one exception. The default model lives per agent while the set it
 * came from lives on the account, so moving the default can orphan it. Dropping a model the new
 * account does not offer leaves the agent unpicked, which blocks its unpinned sends until the user
 * chooses again; keeping it would run the next one on a model that account never listed.
 */
export function withDefaultAccount(
  providers: ProvidersConfig,
  kind: AgentKind,
  accountId: string | undefined,
  accounts: Accounts = [],
): ProvidersConfig {
  const entry = providers[kind] ?? { enabled: true };
  if (accountId === undefined) {
    const { activeAccountId: _cleared, ...rest } = entry;
    return { ...providers, [kind]: rest };
  }
  const offered = accounts.find((candidate) => candidate.id === accountId)?.models;
  const orphaned =
    entry.model !== undefined && !(offered ?? []).some(({ id }) => id === entry.model);
  const { model: _dropped, ...kept } = entry;
  return {
    ...providers,
    [kind]: { ...(orphaned ? kept : entry), activeAccountId: accountId },
  };
}

/**
 * Show or hide one account's models in an agent's pickers. Absent `enabledAccountIds` means every
 * bindable account, so the first disable has to materialize the list from what is bindable *now* —
 * otherwise hiding one account would read as "only this one", hiding every other account too. Once
 * the list exists it is authoritative, so an account added later stays out until enabled.
 *
 * Disabling the agent's default account also clears the default: leaving it would keep resolving
 * unpinned sessions onto an account the user just removed from the menu.
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
  const withList: ProvidersConfig = { ...providers, [kind]: { ...entry, enabledAccountIds: next } };
  return enabled || entry.activeAccountId !== accountId
    ? withList
    : withDefaultAccount(withList, kind, undefined);
}

/** Toggle whether the agent is offered in the client's agent picker. */
export function withEnabled(
  providers: ProvidersConfig,
  kind: AgentKind,
  enabled: boolean,
): ProvidersConfig {
  return { ...providers, [kind]: { ...providers[kind], enabled } };
}

/**
 * Set (or, with undefined, clear) the model an agent runs on. Passing the account the model came
 * from rebinds the agent to it, because a model and the account serving it are one choice — leaving
 * the old binding in place would run the next session on an account that never listed this model.
 */
export function withModel(
  providers: ProvidersConfig,
  kind: AgentKind,
  model: string | undefined,
  accountId?: string,
): ProvidersConfig {
  const entry = providers[kind] ?? { enabled: true };
  if (model === undefined) {
    const { model: _cleared, ...rest } = entry;
    return { ...providers, [kind]: rest };
  }
  return {
    ...providers,
    [kind]: { ...entry, model, ...(accountId !== undefined && { activeAccountId: accountId }) },
  };
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
