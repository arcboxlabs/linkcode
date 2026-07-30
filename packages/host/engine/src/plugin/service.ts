import type {
  PluginDiscoveryOptions,
  PluginProviderAdapterFactory,
  PluginToggleOptions,
  SkillToggleTarget,
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

export interface PluginMutationResult {
  readonly plugin: Plugin;
  /** Install only: provider apps the install left unauthorized. */
  readonly pendingAuthApps?: string[];
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
  ): Effect.Effect<PluginMutationResult, RequestError | OperationError> {
    const adapter = this.factory(provider);
    const toggle = adapter.setPluginEnabled?.bind(adapter);
    if (!toggle) return unsupported(provider, 'plugin management');
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
      Effect.andThen(this.reloadPlugin(provider, id, { cwd: opts.cwd })),
      Effect.map((plugin) => ({ plugin })),
    );
  }

  /**
   * Install a catalog entry. The returned `pendingAuthApps` are provider apps the install left
   * unauthorized — codex reports them for most of its catalog and LinkCode cannot complete those
   * flows, so they are carried to the client instead of being swallowed.
   */
  installPlugin(
    provider: PluginProvider,
    id: string,
    opts: PluginDiscoveryOptions = {},
  ): Effect.Effect<PluginMutationResult, RequestError | OperationError> {
    const adapter = this.factory(provider);
    const install = adapter.installPlugin?.bind(adapter);
    if (!install) return unsupported(provider, 'plugin installation');
    return Effect.tryPromise({
      try: () => install(id, opts),
      catch: (cause) =>
        new OperationError({
          subsystem: 'plugin',
          operation: `plugin.install.${provider}`,
          publicMessage: 'Failed to install the plugin',
          cause,
        }),
    }).pipe(
      Effect.flatMap((outcome) =>
        this.reloadPlugin(provider, id, opts).pipe(
          Effect.map((plugin) => ({ plugin, pendingAuthApps: outcome.pendingAuthApps })),
        ),
      ),
    );
  }

  /**
   * Uninstall. The provider's marketplace snapshot keeps listing the entry (that is how the market
   * catalog shows hundreds of uninstalled plugins), so the readback finds it with no installations
   * rather than gone — a disappearance is a genuine failure, not the success case.
   */
  uninstallPlugin(
    provider: PluginProvider,
    id: string,
    opts: PluginDiscoveryOptions = {},
  ): Effect.Effect<PluginMutationResult, RequestError | OperationError> {
    const adapter = this.factory(provider);
    const uninstall = adapter.uninstallPlugin?.bind(adapter);
    if (!uninstall) return unsupported(provider, 'plugin removal');
    return Effect.tryPromise({
      try: () => uninstall(id, opts),
      catch: (cause) =>
        new OperationError({
          subsystem: 'plugin',
          operation: `plugin.uninstall.${provider}`,
          publicMessage: 'Failed to uninstall the plugin',
          cause,
        }),
    }).pipe(
      Effect.andThen(this.reloadPlugin(provider, id, opts)),
      Effect.map((plugin) => ({ plugin })),
    );
  }

  /**
   * Per-skill toggle. Both providers blind-write (claude edits `skillOverrides`, codex answers
   * `skills/config/write` for any path), so the re-read is the only proof the toggle landed.
   */
  setSkillEnabled(
    provider: PluginProvider,
    skill: SkillToggleTarget,
    enabled: boolean,
    opts: PluginDiscoveryOptions = {},
  ): Effect.Effect<StandaloneSkill, RequestError | OperationError> {
    const adapter = this.factory(provider);
    const toggle = adapter.setSkillEnabled?.bind(adapter);
    if (!toggle) return unsupported(provider, 'skill management');
    return Effect.tryPromise({
      try: () => toggle(skill, enabled, opts),
      catch: (cause) =>
        new OperationError({
          subsystem: 'plugin',
          operation: `skill.set-enabled.${provider}`,
          publicMessage: `Failed to ${enabled ? 'enable' : 'disable'} the skill`,
          cause,
        }),
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => adapter.listStandaloneSkills(opts),
          catch: (cause) =>
            new OperationError({
              subsystem: 'plugin',
              operation: `skill.reload.${provider}`,
              publicMessage: 'Failed to reload the skill after the update',
              cause,
            }),
        }),
      ),
      Effect.flatMap((skills) => {
        const updated = skills.find((entry) => entry.id === skill.id);
        return updated
          ? Effect.succeed(updated)
          : Effect.fail(
              new RequestError({ code: 'not_found', message: `Skill not found: ${skill.id}` }),
            );
      }),
    );
  }

  /** Re-discovers one provider and returns the named plugin. Every mutation ends here: the
   * providers blind-write (a nonexistent plugin still reports success), so this readback is the
   * only proof the change landed. */
  private reloadPlugin(
    provider: PluginProvider,
    id: string,
    opts: PluginDiscoveryOptions,
  ): Effect.Effect<Plugin, RequestError | OperationError> {
    return Effect.tryPromise({
      try: () => this.factory(provider).list(opts),
      catch: (cause) =>
        new OperationError({
          subsystem: 'plugin',
          operation: `plugin.reload.${provider}`,
          publicMessage: 'Failed to reload the plugin after the update',
          cause,
        }),
    }).pipe(
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

/** Server-side capability gate, mirroring the client's `managementCapabilities` gate: a provider
 * that leaves the adapter method undefined refuses the request instead of pretending. */
function unsupported(provider: PluginProvider, what: string): Effect.Effect<never, RequestError> {
  return Effect.fail(
    new RequestError({ code: 'unsupported', message: `${provider}: ${what} is not supported` }),
  );
}

function comparePluginOrder(
  left: { provider: string; id: string },
  right: { provider: string; id: string },
): number {
  const provider = left.provider.localeCompare(right.provider);
  return provider === 0 ? left.id.localeCompare(right.id) : provider;
}
