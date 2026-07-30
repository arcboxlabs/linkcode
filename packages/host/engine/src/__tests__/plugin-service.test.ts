import type { PluginDiscoveryOptions, PluginProviderAdapterFactory } from '@linkcode/agent-adapter';
import type { PluginProvider, StandaloneSkill } from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect } from 'effect';
import { asyncNoop, noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';

import { createEngineRuntime } from '../engine';
import { PluginService } from '../plugin/service';

function plugin(provider: PluginProvider, id: string, enabled = true) {
  return PluginSchema.parse({
    id,
    name: id,
    version: '1.0.0',
    provider,
    keywords: [],
    source: { type: 'local', path: `/plugins/${id}` },
    availability: 'available',
    installations: [{ enabled, scope: 'user' }],
    components: [],
    assets: [],
    managementCapabilities: {
      install: false,
      uninstall: false,
      update: false,
      enable: provider === 'claude-code',
      disable: provider === 'claude-code',
    },
  });
}

function skill(provider: PluginProvider, id: string): StandaloneSkill {
  return {
    provider,
    id,
    name: id,
    scope: 'user',
    path: `/skills/${id}`,
    toggleable: false,
  };
}

describe('PluginService', () => {
  it('aggregates catalogs and standalone skills in stable provider and id order', async () => {
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
      listStandaloneSkills: () =>
        Promise.resolve(provider === 'codex' ? [skill(provider, 'linear')] : []),
    });

    const result = await Effect.runPromise(new PluginService(factory).list({ cwd: '/workspace' }));

    expect(result.plugins.map(({ provider, id }) => `${provider}:${id}`)).toEqual([
      'claude-code:alpha',
      'claude-code:zeta',
      'codex:beta',
    ]);
    expect(result.standaloneSkills).toEqual([skill('codex', 'linear')]);
    expect(result.providerStatus).toEqual([
      { provider: 'claude-code', ok: true },
      { provider: 'codex', ok: true },
    ]);
    expect(options.get('claude-code')).toEqual({ cwd: '/workspace' });
    expect(options.get('codex')).toEqual({ cwd: '/workspace' });
  });

  it('reports a failed provider without hiding healthy results', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () =>
        provider === 'claude-code'
          ? Promise.reject(new Error('native discovery failed'))
          : Promise.resolve([plugin(provider, 'working')]),
      listStandaloneSkills: () => Promise.resolve([]),
    });

    const result = await Effect.runPromise(new PluginService(factory).list());

    expect(result.plugins.map(({ provider, id }) => `${provider}:${id}`)).toEqual([
      'codex:working',
    ]);
    expect(result.providerStatus).toEqual([
      { provider: 'claude-code', ok: false, reason: 'Failed to discover claude-code plugins' },
      { provider: 'codex', ok: true },
    ]);
  });

  it('returns an empty catalog with per-provider failures when every provider fails', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.reject(new Error(`${provider} discovery failed`)),
      listStandaloneSkills: () => Promise.reject(new Error(`${provider} skills failed`)),
    });

    const result = await Effect.runPromise(new PluginService(factory).list());

    expect(result.plugins).toEqual([]);
    expect(result.standaloneSkills).toEqual([]);
    expect(result.providerStatus.every((status) => !status.ok)).toBe(true);
  });

  it('toggles through the adapter and returns the re-listed plugin', async () => {
    const setPluginEnabled = vi.fn(asyncNoop);
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([plugin(provider, 'latex@team-tools', false)]),
      listStandaloneSkills: () => Promise.resolve([]),
      ...(provider === 'claude-code' && { setPluginEnabled }),
    });

    const updated = await Effect.runPromise(
      new PluginService(factory).setPluginEnabled('claude-code', 'latex@team-tools', false, {
        scope: 'user',
        cwd: '/workspace',
      }),
    );

    expect(setPluginEnabled).toHaveBeenCalledWith('latex@team-tools', false, {
      scope: 'user',
      cwd: '/workspace',
    });
    expect(updated.id).toBe('latex@team-tools');
  });

  it('fails with unsupported before touching an adapter without a toggle', async () => {
    const list = vi.fn();
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list,
      listStandaloneSkills: () => Promise.resolve([]),
    });

    const outcome = await Effect.runPromise(
      Effect.flip(new PluginService(factory).setPluginEnabled('codex', 'any', true)),
    );

    expect(outcome).toMatchObject({ _tag: 'RequestError', code: 'unsupported' });
    expect(list).not.toHaveBeenCalled();
  });

  it('fails with not_found when the toggled plugin never shows up in the readback', async () => {
    // claude's enable/disable exits 0 even for unknown plugins — the readback is the real check.
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([]),
      listStandaloneSkills: () => Promise.resolve([]),
      setPluginEnabled: asyncNoop,
    });

    const outcome = await Effect.runPromise(
      Effect.flip(
        new PluginService(factory).setPluginEnabled('claude-code', 'ghost@nowhere', true),
      ),
    );

    expect(outcome).toMatchObject({ _tag: 'RequestError', code: 'not_found' });
  });

  it('exposes the injected provider aggregation through the Engine runtime', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([plugin(provider, 'runtime')]),
      listStandaloneSkills: () => Promise.resolve([]),
    });
    const transport: Transport = {
      connect: () => Promise.resolve(),
      send: noop,
      onMessage: () => noop,
      onClose: () => noop,
      close: noop,
    };

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* createEngineRuntime(transport, { pluginFactory: factory });
          return yield* engine.listPlugins({ cwd: '/workspace' });
        }),
      ),
    );

    expect(result.plugins.map(({ provider, id }) => `${provider}:${id}`)).toEqual([
      'claude-code:runtime',
      'codex:runtime',
    ]);
  });
});
