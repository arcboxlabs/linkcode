import type {
  Account,
  Accounts,
  ProviderConfig,
  ProvidersConfig,
  StartOptions,
} from '@linkcode/schema';

/**
 * Daemon-owned data-plane config store (docs/ARCHITECTURE.md#packages--repo-layout): the per-agent
 * provider settings plus the global account pool. The host reads it to inject per-agent defaults at
 * session start and services `config.get` / `config.set` over the wire. The daemon supplies a
 * persistent implementation; the in-memory default keeps the Engine usable standalone (tests / no
 * daemon).
 */
export interface ProviderConfigStore {
  get(): ProvidersConfig;
  set(next: ProvidersConfig): void | Promise<void>;
  /** The global account pool bound by `providers[kind].activeAccountId`. */
  getAccounts(): Accounts;
  setAccounts(next: Accounts): void | Promise<void>;
}

export class InMemoryProviderConfigStore implements ProviderConfigStore {
  private providers: ProvidersConfig = {};
  private accounts: Accounts = [];

  get(): ProvidersConfig {
    return this.providers;
  }

  set(next: ProvidersConfig): void {
    this.providers = next;
  }

  getAccounts(): Accounts {
    return this.accounts;
  }

  setAccounts(next: Accounts): void {
    this.accounts = next;
  }
}

/**
 * Resolve the account a session should use, by precedence:
 *   1. `opts.config.accountId` — an explicit per-session pick.
 *   2. `providers[kind].activeAccountId` — the agent's default account.
 * Returns undefined when neither resolves, or when the resolved id is stale (the account was
 * deleted from the pool) — the caller then falls back to the legacy `providers[kind].apiKey`.
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

/**
 * The adapter-facing bundle an account contributes to `StartOptions.config`. Credential keys follow
 * the existing `apiKey` convention; `authToken` / `baseUrl` / `protocol` / `extraEnv` are consumed by
 * the per-agent injection seams (each adapter maps them to its own env / options). An `oauth` account
 * injects no secret — it delegates to the agent CLI's own login store.
 */
function accountConfigBundle(account: Account): Record<string, unknown> {
  const bundle: Record<string, unknown> = {};
  const { credential, endpoint, extraEnv } = account;
  if (credential.type === 'api-key') bundle.apiKey = credential.key;
  else if (credential.type === 'auth-token') bundle.authToken = credential.token;
  if (endpoint) {
    bundle.baseUrl = endpoint.baseUrl;
    bundle.protocol = endpoint.protocol;
  }
  if (extraEnv) bundle.extraEnv = extraEnv;
  return bundle;
}

/**
 * Apply the stored data-plane config to a session's StartOptions: resolve the bound account (or the
 * legacy per-agent api key), fall back to the configured default model, and inject the resolved
 * credential/endpoint bundle into `config` (each adapter consumes it its own way). A resolved
 * account's own `model` outranks the provider default. Returns a new object; never mutates the input.
 */
export function applyProviderDefaults(
  opts: StartOptions,
  providers: ProvidersConfig,
  accounts: Accounts = [],
): StartOptions {
  const config = providers[opts.kind];
  const account = resolveAccount(opts, config, accounts);
  if (!config && !account) return opts;

  const next: StartOptions = { ...opts };
  if (next.model === undefined) {
    const model = account?.model ?? config?.defaultModel;
    if (model !== undefined) next.model = model;
  }
  if (account) {
    next.config = { ...next.config, ...accountConfigBundle(account) };
  } else if (config?.apiKey !== undefined) {
    // Legacy: no account bound — fall back to the provider's bare api key.
    next.config = { ...next.config, apiKey: config.apiKey };
  }
  return next;
}
