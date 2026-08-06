import type { BindingUnavailableReason } from '@linkcode/providers';
import { resolveBinding } from '@linkcode/providers';
import type {
  Account,
  Accounts,
  AgentKind,
  CustomMcpServer,
  ProviderConfig,
  ProvidersConfig,
  StartOptions,
} from '@linkcode/schema';

/**
 * Daemon-owned data-plane config store: per-agent provider settings plus the global account pool,
 * read for defaults at session start and serviced over `config.get` / `config.set`. The daemon
 * supplies a persistent implementation; the in-memory default keeps the Engine usable standalone.
 */
export interface ProviderConfigStore {
  get(): ProvidersConfig;
  /** The global account pool bound by `providers[kind].activeAccountId`. */
  getAccounts(): Accounts;
  update(next: { providers?: ProvidersConfig; accounts?: Accounts }): void | Promise<void>;
  /** LinkCode-owned custom MCP servers (full plaintext — masking is the data plane's job). */
  getCustomMcpServers(): CustomMcpServer[];
  setCustomMcpServers(next: CustomMcpServer[]): void | Promise<void>;
  createAndBindAccount(agent: AgentKind, account: Account): void | Promise<void>;
}

export class InMemoryProviderConfigStore implements ProviderConfigStore {
  private providers: ProvidersConfig = {};
  private accounts: Accounts = [];
  private customMcpServers: CustomMcpServer[] = [];

  get(): ProvidersConfig {
    return this.providers;
  }

  getAccounts(): Accounts {
    return this.accounts;
  }

  update(next: { providers?: ProvidersConfig; accounts?: Accounts }): void {
    if (next.providers !== undefined) this.providers = next.providers;
    if (next.accounts !== undefined) this.accounts = next.accounts;
  }

  getCustomMcpServers(): CustomMcpServer[] {
    return this.customMcpServers;
  }

  setCustomMcpServers(next: CustomMcpServer[]): void {
    this.customMcpServers = next;
  }

  createAndBindAccount(agent: AgentKind, account: Account): void {
    const next = accountBinding(this.providers, this.accounts, agent, account);
    this.providers = next.providers;
    this.accounts = next.accounts;
  }
}

export function accountBinding(
  providers: ProvidersConfig,
  accounts: Accounts,
  agent: AgentKind,
  account: Account,
): { providers: ProvidersConfig; accounts: Accounts } {
  const entry = providers[agent] ?? { enabled: true };
  const exists = accounts.some((candidate) => candidate.id === account.id);
  return {
    providers: { ...providers, [agent]: { ...entry, activeAccountId: account.id } },
    accounts: exists
      ? accounts.map((candidate) => (candidate.id === account.id ? account : candidate))
      : [...accounts, account],
  };
}

/**
 * Resolve the session's account: explicit `opts.config.accountId`, else the agent's
 * `activeAccountId`. Undefined when neither resolves or the id is stale (account deleted) —
 * the caller then falls back to the legacy `providers[kind].apiKey`.
 */
function resolveAccount(
  opts: StartOptions,
  config: ProviderConfig | undefined,
  accounts: Accounts,
): Account | undefined {
  const requestedId =
    typeof opts.config?.accountId === 'string' ? opts.config.accountId : undefined;
  const id = requestedId ?? config?.activeAccountId;
  if (id === undefined) return undefined;
  return accounts.find((account) => account.id === id);
}

/** The adapter-facing bundle an account contributes to `StartOptions.config`; each adapter maps
 * the keys to its own env/options. An `oauth` account injects no secret — it delegates to the
 * agent CLI's own login store. The endpoint is resolved per agent, so one account can serve
 * several natively. */
function accountConfigBundle(
  account: Account,
  kind: AgentKind,
): { bundle: Record<string, unknown> } | { unavailable: BindingUnavailableReason } {
  const binding = resolveBinding(account, kind);
  if (binding.tier === 'unavailable') return { unavailable: binding.reason };
  // Echoed back so the caller can record which account a run actually resolved to; `resolveAccount`
  // reads the same key on the way in, which is how a client pins a session to one account.
  const bundle: Record<string, unknown> = { accountId: account.id };
  const { credential, extraEnv } = account;
  if (credential.type === 'api-key') bundle.apiKey = credential.key;
  else if (credential.type === 'auth-token') bundle.authToken = credential.token;
  if (binding.baseUrl !== undefined) bundle.baseUrl = binding.baseUrl;
  if (binding.protocol !== undefined) bundle.protocol = binding.protocol;
  if (binding.knownProvider !== undefined) bundle.knownProvider = binding.knownProvider;
  if (extraEnv) bundle.extraEnv = extraEnv;
  return { bundle };
}

/** The account a resolved `StartOptions` names — written by `accountConfigBundle`, or pinned by a
 * client that picked a model belonging to a specific account. Callers record it per run; the rest of
 * `config` carries secrets and must never be persisted. */
export function resolvedAccountId(opts: StartOptions): string | undefined {
  const id = opts.config?.accountId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export interface AppliedProviderDefaults {
  readonly options: StartOptions;
  /** Why the bound account cannot back this agent. A session must refuse to start rather than
   * run against an endpoint the agent cannot speak; pre-session reads may ignore it. */
  readonly unavailable?: BindingUnavailableReason;
}

/** Apply the stored config to a session's StartOptions: resolve the bound account (or legacy
 * per-agent api key), inject the credential/endpoint bundle into `config`, and fall back to the
 * agent's persisted model pick. Returns a new object; never mutates the input. */
export function applyProviderDefaults(
  opts: StartOptions,
  providers: ProvidersConfig,
  accounts: Accounts = [],
): AppliedProviderDefaults {
  const config = providers[opts.kind];
  const account = resolveAccount(opts, config, accounts);
  if (!config && !account) return { options: opts };

  const next: StartOptions = { ...opts };
  // The account holds the models the user may pick from; the pick itself is per agent.
  if (next.model === undefined && config?.model !== undefined) next.model = config.model;
  if (account) {
    const resolved = accountConfigBundle(account, opts.kind);
    if ('unavailable' in resolved) return { options: next, unavailable: resolved.unavailable };
    next.config = { ...next.config, ...resolved.bundle };
  } else if (config?.apiKey !== undefined) {
    // Legacy: no account bound — fall back to the provider's bare api key.
    next.config = { ...next.config, apiKey: config.apiKey };
  }
  return { options: next };
}
