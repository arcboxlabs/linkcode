import type { PluginDiscoveryOptions, PluginProviderAdapterFactory } from '@linkcode/agent-adapter';
import type { PluginProvider } from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';

import { createEngineRuntime } from '../engine';
import { PluginService } from '../plugin/service';

function plugin(provider: PluginProvider, id: string) {
  return PluginSchema.parse({
    id,
    name: id,
    version: '1.0.0',
    provider,
    keywords: [],
    source: { type: 'local', path: `/plugins/${id}` },
    availability: 'available',
    installations: [],
    components: [],
    assets: [],
    managementCapabilities: {
      install: false,
      uninstall: false,
      update: false,
      enable: false,
      disable: false,
    },
  });
}

describe('PluginService', () => {
  it('aggregates provider catalogs in stable provider and id order', async () => {
    const options = new Map<PluginProvider, PluginDiscoveryOptions | undefined>();
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list(opts) {
        options.set(provider, opts);

        return Promise.resolve(
          provider === 'claude-code'
            ? [plugin(provider, 'zeta'), plugin(provider, 'alpha')]
            : [plugin(provider, 'beta')],
        );
      },
    });

    const plugins = await Effect.runPromise(new PluginService(factory).list({ cwd: '/workspace' }));

    expect(plugins.map(({ provider, id }) => `${provider}:${id}`)).toEqual([
      'claude-code:alpha',
      'claude-code:zeta',
      'codex:beta',
    ]);
    expect(options.get('claude-code')).toEqual({ cwd: '/workspace' });
    expect(options.get('codex')).toEqual({ cwd: '/workspace' });
  });

  it('keeps healthy provider results when another provider fails', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () =>
        provider === 'claude-code'
          ? Promise.reject(new Error('native discovery failed'))
          : Promise.resolve([plugin(provider, 'working')]),
    });

    const plugins = await Effect.runPromise(new PluginService(factory).list());

    expect(plugins.map(({ provider, id }) => `${provider}:${id}`)).toEqual(['codex:working']);
  });

  it('returns an empty catalog when every provider fails', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.reject(new Error(`${provider} discovery failed`)),
    });

    const plugins = await Effect.runPromise(new PluginService(factory).list());

    expect(plugins).toEqual([]);
  });

  it('exposes the injected provider aggregation through the Engine runtime', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([plugin(provider, 'runtime')]),
    });
    const transport: Transport = {
      connect: () => Promise.resolve(),
      send: noop,
      onMessage: () => noop,
      onClose: () => noop,
      close: noop,
    };

    const plugins = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* createEngineRuntime(transport, { pluginFactory: factory });
          return yield* engine.listPlugins({ cwd: '/workspace' });
        }),
      ),
    );

    expect(plugins.map(({ provider, id }) => `${provider}:${id}`)).toEqual([
      'claude-code:runtime',
      'codex:runtime',
    ]);
  });
});
