import type { Accounts, ProvidersConfig, StartOptions } from '@linkcode/schema';

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
 * Apply the stored per-agent provider config to a session's StartOptions: fall back to the configured
 * default model when the client didn't specify one, and inject the API key into `config.apiKey` (each
 * adapter consumes it its own way). Returns a new object; never mutates the input.
 */
export function applyProviderDefaults(
  opts: StartOptions,
  providers: ProvidersConfig,
): StartOptions {
  const config = providers[opts.kind];
  if (!config) return opts;

  const next: StartOptions = { ...opts };
  if (next.model === undefined && config.defaultModel !== undefined) {
    next.model = config.defaultModel;
  }
  if (config.apiKey !== undefined) {
    next.config = { ...next.config, apiKey: config.apiKey };
  }
  return next;
}
