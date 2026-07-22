import type {
  Account,
  Accounts,
  PluginConfig,
  PluginConfigPublic,
  PluginConfigSet,
  ProviderConfig,
  ProvidersConfig,
  StartOptions,
} from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';

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
  /** Global MCP plugin enablement and daemon-local connector credentials. */
  getPlugins(): PluginConfig;
  setPlugins(next: PluginConfig): void | Promise<void>;
}

export class InMemoryProviderConfigStore implements ProviderConfigStore {
  private providers: ProvidersConfig = {};
  private accounts: Accounts = [];
  private plugins: PluginConfig = { units: [], connectors: [] };

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

  getPlugins(): PluginConfig {
    return this.plugins;
  }

  setPlugins(next: PluginConfig): void {
    this.plugins = next;
  }
}

/** Apply one validated plugin patch without mutating the stored snapshot. Connector deletion also
 * disables and unbinds every unit that referenced it, so a successful write cannot create stale
 * references through deletion. */
export function applyPluginConfigSet(current: PluginConfig, patch: PluginConfigSet): PluginConfig {
  let units = patch.units === undefined ? current.units : patch.units;
  let connectors = current.connectors;

  for (const operation of patch.connectorOperations ?? []) {
    const connectorId =
      operation.type === 'create' ? operation.connector.id : operation.connectorId;
    const existing = connectors.find((connector) => connector.id === connectorId);
    switch (operation.type) {
      case 'create':
        if (existing !== undefined) {
          throw new TypeError(`Plugin connector already exists: ${operation.connector.id}`);
        }
        connectors = [...connectors, operation.connector];
        break;
      case 'update': {
        const existingConnector = nullthrow(
          existing,
          `Plugin connector does not exist: ${operation.connectorId}`,
        );
        const next = { ...existingConnector };
        if (operation.label !== undefined) {
          if (operation.label === null) {
            delete next.label;
          } else {
            next.label = operation.label;
          }
        }
        if (operation.credential !== undefined) {
          next.credential = operation.credential;
        }
        connectors = connectors.map((connector) =>
          connector.id === operation.connectorId ? next : connector,
        );
        break;
      }
      case 'delete':
        nullthrow(existing, `Plugin connector does not exist: ${operation.connectorId}`);
        connectors = connectors.filter((connector) => connector.id !== operation.connectorId);
        units = units.map((unit) =>
          unit.binding?.type === 'local' && unit.binding.connectorId === operation.connectorId
            ? { unitId: unit.unitId, enabled: false }
            : unit,
        );
        break;
      default:
        break;
    }
  }

  return { units, connectors };
}

/** Remove connector secrets at the data-plane boundary. A configured credential is represented by
 * metadata only; no mask string is ever returned or eligible to be written back as a secret. */
export function publicPluginConfig(config: PluginConfig): PluginConfigPublic {
  return {
    units: config.units,
    connectors: config.connectors.map(({ credential, ...connector }) => ({
      ...connector,
      credential: {
        type: credential.type,
        configured: true,
        ...(credential.expiresAt !== undefined && { expiresAt: credential.expiresAt }),
      },
    })),
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
