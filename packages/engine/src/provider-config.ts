import type { ProvidersConfig, StartOptions } from '@linkcode/schema';

/**
 * Daemon-owned provider config store (data plane, docs/ARCHITECTURE.md#packages--repo-layout). The host reads it to inject
 * per-agent defaults at session start and services `config.get` / `config.set` over the wire. The
 * daemon supplies a persistent implementation; the in-memory default keeps the Engine usable
 * standalone (tests / no daemon).
 */
export interface ProviderConfigStore {
  get(): ProvidersConfig;
  set(next: ProvidersConfig): void | Promise<void>;
}

export class InMemoryProviderConfigStore implements ProviderConfigStore {
  private providers: ProvidersConfig = {};

  get(): ProvidersConfig {
    return this.providers;
  }

  set(next: ProvidersConfig): void {
    this.providers = next;
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
