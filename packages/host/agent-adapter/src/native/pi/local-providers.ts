import type { AgentLocalProvider } from '@linkcode/schema';
import type { PiSdk } from './history';

type PiRegistry = ReturnType<PiSdk['ModelRegistry']['create']>;

/**
 * Providers defined by the user's own `~/.pi/agent/models.json`, derived by diffing the full
 * registry against a models.json-less one (`ModelRegistry.inMemory`): a provider id present only
 * with models.json loaded is a local custom provider. The diff is provider-level on purpose —
 * custom models ADDED under a built-in provider stay attributed to that provider, and a
 * models.json entry that only overrides a built-in provider's baseUrl is an endpoint override,
 * not a local provider. Reads `getAll()`, not `getAvailable()`: the scan reports what is defined,
 * auth-gating stays the model catalog's concern.
 */
export function piLocalProviders(pi: PiSdk, registry: PiRegistry): AgentLocalProvider[] {
  const builtIn = new Set(
    pi.ModelRegistry.inMemory(registry.authStorage)
      .getAll()
      .map((model) => model.provider),
  );
  const byProvider = new Map<string, { baseUrl: string | undefined; models: string[] }>();
  for (const model of registry.getAll()) {
    if (builtIn.has(model.provider)) continue;
    const entry = byProvider.get(model.provider) ?? { baseUrl: undefined, models: [] };
    entry.baseUrl ??= model.baseUrl;
    entry.models.push(model.id);
    byProvider.set(model.provider, entry);
  }
  return [...byProvider].map(([id, entry]) => ({
    id,
    ...(entry.baseUrl !== undefined && { baseUrl: entry.baseUrl }),
    models: entry.models,
  }));
}
