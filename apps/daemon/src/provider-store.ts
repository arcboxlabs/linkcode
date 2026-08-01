import type { ProviderConfigStore } from '@linkcode/engine';
import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { saveProviderConfiguration } from './config';
import type { SecretVault } from './secrets';

/**
 * Daemon-backed data-plane config store: in-memory providers + account pool seeded at boot, each
 * persisted to `~/.linkcode/config.json` on write. Injected into the Engine so `config.get` /
 * `config.set` and per-session provider defaults read and write the same persisted values.
 */
export function createProviderConfigStore(
  vault: SecretVault,
  initialProviders: ProvidersConfig,
  initialAccounts: Accounts,
): ProviderConfigStore {
  let providers = initialProviders;
  let accounts = initialAccounts;
  return {
    get: () => providers,
    getAccounts: () => accounts,
    update(next) {
      const nextProviders = next.providers ?? providers;
      const nextAccounts = next.accounts ?? accounts;
      saveProviderConfiguration(vault, nextProviders, nextAccounts);
      providers = nextProviders;
      accounts = nextAccounts;
    },
  };
}
