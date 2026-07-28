import type {
  Account,
  Accounts,
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
 * agent CLI's own login store. */
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

/** Apply the stored config to a session's StartOptions: resolve the bound account (or legacy
 * per-agent api key) and inject the credential/endpoint bundle into `config`; a resolved account's
 * `model` outranks the provider default. Returns a new object; never mutates the input. */
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
