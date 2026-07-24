import type { PluginDiscoveryOptions, PluginProviderAdapterFactory } from '@linkcode/agent-adapter';
import type { Plugin, PluginProvider } from '@linkcode/schema';
import { PluginProviderSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError } from '../failure';

/** Aggregates provider-native catalogs while keeping one unavailable CLI from hiding the rest. */
export class PluginService {
  constructor(private readonly factory: PluginProviderAdapterFactory) {}

  list(opts: PluginDiscoveryOptions = {}): Effect.Effect<Plugin[]> {
    return Effect.all(
      PluginProviderSchema.options.map((provider) => this.listProvider(provider, opts)),
      { concurrency: 'unbounded' },
    ).pipe(
      Effect.map((catalogs) =>
        catalogs.flat().sort((left, right) => {
          const provider = left.provider.localeCompare(right.provider);
          return provider === 0 ? left.id.localeCompare(right.id) : provider;
        }),
      ),
    );
  }

  private listProvider(
    provider: PluginProvider,
    opts: PluginDiscoveryOptions,
  ): Effect.Effect<Plugin[]> {
    return Effect.tryPromise({
      try: () => this.factory(provider).list(opts),
      catch: (cause) =>
        new OperationError({
          subsystem: 'agent',
          operation: `plugin.list.${provider}`,
          publicMessage: `Failed to discover ${provider} plugins`,
          cause,
        }),
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          error.publicMessage,
          { operation: error.operation, provider, subsystem: error.subsystem },
          error.cause,
        ).pipe(Effect.andThen(Effect.succeed(new Array<Plugin>()))),
      ),
    );
  }
}
