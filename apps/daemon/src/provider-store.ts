import type { ProviderConfigStore } from '@linkcode/engine';
import type { ProvidersConfig } from '@linkcode/schema';
import { saveProviders } from './config';

/**
 * Daemon-backed provider config store: in-memory config seeded at boot, persisted to
 * `~/.linkcode/config.json` on every write. Injected into the Engine so `config.get` / `config.set`
 * and per-session provider defaults read and write the same persisted values.
 */
export function createProviderConfigStore(initial: ProvidersConfig): ProviderConfigStore {
  let providers = initial;
  return {
    get: () => providers,
    set(next) {
      providers = next;
      saveProviders(next);
    },
  };
}
