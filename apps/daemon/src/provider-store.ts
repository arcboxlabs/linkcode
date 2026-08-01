import type { ProviderConfigStore } from '@linkcode/engine';
import { accountBinding } from '@linkcode/engine';
import type { Accounts, CustomMcpServer, ProvidersConfig } from '@linkcode/schema';
import { saveCustomMcpServers, saveProviderConfiguration } from './config';
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
    getAccounts: () => accounts,
    update(next) {
      const nextProviders = next.providers ?? providers;
      const nextAccounts = next.accounts ?? accounts;
      saveProviderConfiguration(vault, nextProviders, nextAccounts);
      providers = nextProviders;
      accounts = nextAccounts;
    },
    getCustomMcpServers: () => customMcpServers,
    setCustomMcpServers(next) {
      saveCustomMcpServers(vault, next, customMcpServers);
      customMcpServers = next;
    },
    createAndBindAccount(agent, account) {
      const next = accountBinding(providers, accounts, agent, account);
      saveProviderConfiguration(vault, next.providers, next.accounts);
      providers = next.providers;
      accounts = next.accounts;
    },
  };
}
