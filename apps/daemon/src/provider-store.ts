import type { ProviderConfigStore } from '@linkcode/engine';
import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { saveAccounts, saveProviders } from './config';

/**
 * Daemon-backed data-plane config store: in-memory providers + account pool seeded at boot, each
 * persisted to `~/.linkcode/config.json` on write. Injected into the Engine so `config.get` /
 * `config.set` and per-session provider defaults read and write the same persisted values.
 */
export function createProviderConfigStore(
  initialProviders: ProvidersConfig,
  initialAccounts: Accounts,
): ProviderConfigStore {
  let providers = initialProviders;
  let accounts = initialAccounts;
  return {
    get: () => providers,
    set(next) {
      providers = next;
      saveProviders(next);
    },
    getAccounts: () => accounts,
    setAccounts(next) {
      accounts = next;
      saveAccounts(next);
    },
  };
}
