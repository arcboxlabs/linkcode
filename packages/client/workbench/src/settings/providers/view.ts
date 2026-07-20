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
  ProviderBindingStatus,
  ProviderBindingViewModel,
  ProviderCredentialViewModel,
} from '@linkcode/ui';
import { bindingAvailability } from './capability';
import { detectedLoginSuggestions, serviceById } from './catalog';

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

function bindingStatus(
  account: Account,
  accountLabels: ReadonlyMap<string, string>,
  kind: AgentKind,
  providers: ProvidersConfig | undefined,
): { bound: boolean; status: ProviderBindingStatus; tier: ProviderBindingViewModel['tier'] } {
  const availability = bindingAvailability(account, kind);
  const boundId = providers?.[kind]?.activeAccountId;
  const bound = boundId === account.id;
  if (availability.tier === 'unavailable') {
    if (availability.reason === 'oauth-other-agent' && account.credential.type === 'oauth') {
      return {
        bound,
        tier: availability.tier,
        status: { kind: 'unavailable-oauth', agent: account.credential.agent },
      };
    }
    return {
      bound,
      tier: availability.tier,
      status: {
        kind:
          availability.reason === 'translation-needs-endpoint'
            ? 'unavailable-translation-endpoint'
            : 'unavailable-protocol',
      },
    };
  }
  return {
    bound,
    tier: availability.tier,
    status: bound
      ? { kind: 'bound' }
      : boundId === undefined
        ? { kind: 'no-provider' }
        : { kind: 'bound-elsewhere', accountLabel: accountLabels.get(boundId) ?? boundId },
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
  const bindings = AGENT_KINDS.map((kind): ProviderBindingViewModel => {
    const binding = bindingStatus(account, accountLabels, kind, providers);
    return {
      kind,
      ...binding,
      currentModel: providers?.[kind]?.defaultModel ?? '',
    };
  });
  const boundAgents = boundAgentKinds(providers, account.id);
  const serviceLabel = serviceById(account.service)?.label;
  return {
    id: account.id,
    label: account.label,
    credential: credentialViewModel(account, runtimes),
    bindings,
    boundAgents,
    availableBindingCount: bindings.filter((binding) => binding.tier !== 'unavailable').length,
    ...(!(account.service === undefined) && { service: account.service }),
    ...(!(serviceLabel === undefined) && { serviceLabel }),
    ...(!(account.endpoint === undefined) && { endpoint: account.endpoint }),
    ...(!(account.model === undefined) && { accountModel: account.model }),
    ...(account.customProvider !== undefined && {
      customProvider: {
        name: account.customProvider.name,
        models: account.customProvider.models.map((model) => ({ id: model.id })),
      },
    }),
    ...(!(boundAgents.length === 0) && {
      configPreview: accountConfigSnippet(providers, account.id),
    }),
  };
}

function providerAccountListItem(
  account: Account,
  providers: ProvidersConfig | undefined,
  runtimes: AgentRuntimes | undefined,
): ProviderAccountListItem {
  const serviceLabel = serviceById(account.service)?.label;
  const auth =
    account.credential.type === 'oauth' ? runtimes?.[account.credential.agent]?.auth : undefined;
  return {
    id: account.id,
    label: account.label,
    boundAgents: boundAgentKinds(providers, account.id),
    ...(account.service !== undefined && { service: account.service }),
    ...(serviceLabel !== undefined && { serviceLabel }),
    ...(account.endpoint !== undefined && { endpoint: account.endpoint.baseUrl }),
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
