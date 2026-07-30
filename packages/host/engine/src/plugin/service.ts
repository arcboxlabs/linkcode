import type {
  PluginDiscoveryOptions,
  PluginProviderAdapterFactory,
  PluginToggleOptions,
} from '@linkcode/agent-adapter';
import type {
  Plugin,
  PluginProvider,
  PluginProviderStatus,
  StandaloneSkill,
} from '@linkcode/schema';
import { PluginProviderSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';

export interface PluginDiscoveryResult {
  readonly plugins: Plugin[];
  readonly standaloneSkills: StandaloneSkill[];
  /** Per-provider outcome so "no plugins" and "CLI missing/failed" stay distinguishable. */
  readonly providerStatus: PluginProviderStatus[];
}

interface ProviderDiscovery {
  readonly plugins: Plugin[];
  readonly standaloneSkills: StandaloneSkill[];
  readonly status: PluginProviderStatus;
}

/** Aggregates provider-native catalogs while keeping one unavailable CLI from hiding the rest. */
export class PluginService {
  constructor(private readonly factory: PluginProviderAdapterFactory) {}

  list(opts: PluginDiscoveryOptions = {}): Effect.Effect<PluginDiscoveryResult> {
    return Effect.all(
      PluginProviderSchema.options.map((provider) => this.discoverProvider(provider, opts)),
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.map((results) => ({
        plugins: results
          .flatMap((result) => result.plugins)
          .sort((left, right) => comparePluginOrder(left, right)),
        standaloneSkills: results
          .flatMap((result) => result.standaloneSkills)
          .sort((left, right) => comparePluginOrder(left, right)),
        providerStatus: results.map((result) => result.status),
      })),
    );
  }

  /**
   * Plugin-level toggle. The post-toggle re-list is the real success check, not an optimization:
   * claude's enable/disable exits 0 even for a plugin that does not exist (verified on 2.1.220),
   * so only the readback proves the toggle landed on a real install.
   */
  setPluginEnabled(
    provider: PluginProvider,
    id: string,
    enabled: boolean,
    opts: PluginToggleOptions = {},
  ): Effect.Effect<Plugin, RequestError | OperationError> {
    const adapter = this.factory(provider);
    const toggle = adapter.setPluginEnabled?.bind(adapter);
    if (!toggle) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: `${provider}: plugin management is not supported`,
        }),
      );
    }
    return Effect.tryPromise({
      try: () => toggle(id, enabled, opts),
      catch: (cause) =>
        new OperationError({
          subsystem: 'plugin',
          operation: `plugin.set-enabled.${provider}`,
          publicMessage: `Failed to ${enabled ? 'enable' : 'disable'} the plugin`,
          cause,
        }),
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => adapter.list({ cwd: opts.cwd }),
          catch: (cause) =>
            new OperationError({
              subsystem: 'plugin',
              operation: `plugin.reload.${provider}`,
              publicMessage: 'Failed to reload the plugin after the update',
              cause,
            }),
        }),
      ),
      Effect.flatMap((plugins) => {
        const updated = plugins.find((plugin) => plugin.id === id);
        return updated
          ? Effect.succeed(updated)
          : Effect.fail(
              new RequestError({ code: 'not_found', message: `Plugin not found: ${id}` }),
            );
      }),
    );
  }

  private discoverProvider(
    provider: PluginProvider,
    opts: PluginDiscoveryOptions,
  ): Effect.Effect<ProviderDiscovery> {
    const adapter = this.factory(provider);
    return Effect.all(
      [
        this.discoveryCall(provider, 'plugins', () => adapter.list(opts)),
        this.discoveryCall(provider, 'skills', () => adapter.listStandaloneSkills(opts)),
      ],
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.map(([plugins, standaloneSkills]) => {
        const reason = plugins.reason ?? standaloneSkills.reason;
        return {
          plugins: plugins.values,
          standaloneSkills: standaloneSkills.values,
          status: { provider, ok: reason === undefined, ...(reason && { reason }) },
        };
      }),
    );
  }

  private discoveryCall<T>(
    provider: PluginProvider,
    what: 'plugins' | 'skills',
    run: () => Promise<T[]>,
  ): Effect.Effect<{ values: T[]; reason?: string }> {
    return Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new OperationError({
          subsystem: 'plugin',
          operation: `plugin.list.${what}.${provider}`,
          publicMessage: `Failed to discover ${provider} ${what}`,
          cause,
        }),
    }).pipe(
      Effect.map((values) => ({ values })),
      Effect.catch((error) =>
        Effect.logWarning(
          error.publicMessage,
          { operation: error.operation, provider, subsystem: error.subsystem },
          error.cause,
        ).pipe(
          Effect.andThen(Effect.succeed({ values: new Array<T>(), reason: error.publicMessage })),
        ),
      ),
    );
  }
}

function comparePluginOrder(
  left: { provider: string; id: string },
  right: { provider: string; id: string },
): number {
  const provider = left.provider.localeCompare(right.provider);
  return provider === 0 ? left.id.localeCompare(right.id) : provider;
}
