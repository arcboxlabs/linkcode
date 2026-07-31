import type { ProviderConfigStore } from '@linkcode/engine';
import type { Accounts, CustomMcpServer, ProvidersConfig } from '@linkcode/schema';
import { saveAccounts, saveCustomMcpServers, saveProviders } from './config';
import type { SecretVault } from './secrets';

/**
 * Daemon-backed data-plane config store: in-memory providers + account pool + custom MCP servers
 * seeded at boot, each persisted to `~/.linkcode/config.json` on write. Injected into the Engine
 * so `config.get` / `config.set` and per-session provider defaults read and write the same
 * persisted values.
 */
export function createProviderConfigStore(
  vault: SecretVault,
  initialProviders: ProvidersConfig,
  initialAccounts: Accounts,
  initialCustomMcpServers: CustomMcpServer[] = [],
): ProviderConfigStore {
  let providers = initialProviders;
  let accounts = initialAccounts;
  let customMcpServers = initialCustomMcpServers;
  return {
    get: () => providers,
    set(next) {
      saveProviders(vault, next);
      providers = next;
    },
    getAccounts: () => accounts,
    setAccounts(next) {
      saveAccounts(vault, next);
      accounts = next;
    },
    getCustomMcpServers: () => customMcpServers,
    setCustomMcpServers(next) {
      saveCustomMcpServers(next);
      customMcpServers = next;
    },
  };
}
