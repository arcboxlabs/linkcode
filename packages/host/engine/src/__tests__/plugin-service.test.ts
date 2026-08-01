import type { PluginDiscoveryOptions, PluginProviderAdapterFactory } from '@linkcode/agent-adapter';
import type { PluginProvider, StandaloneSkill } from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect, Fiber } from 'effect';
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
    enabled: true,
    toggleable: true,
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
    expect(updated.plugin.id).toBe('latex@team-tools');
  });

  it('installs through the adapter and carries the apps still needing authorization', async () => {
    const installPlugin = vi.fn(() => Promise.resolve({ pendingAuthApps: ['GitHub'] }));
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([plugin(provider, 'github@curated', true)]),
      listStandaloneSkills: () => Promise.resolve([]),
      ...(provider === 'codex' && { installPlugin }),
    });

    const result = await Effect.runPromise(
      new PluginService(factory).installPlugin('codex', 'github@curated', { cwd: '/workspace' }),
    );

    expect(installPlugin).toHaveBeenCalledWith('github@curated', {
      cwd: '/workspace',
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({
      plugin: { id: 'github@curated' },
      pendingAuthApps: ['GitHub'],
    });
  });

  it('uninstalls through the adapter and returns the entry that survives in the catalog', async () => {
    const uninstallPlugin = vi.fn(asyncNoop);
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      // The marketplace snapshot keeps listing an uninstalled plugin, with no installations.
      list: () =>
        Promise.resolve([{ ...plugin(provider, 'chrome@bundled', true), installations: [] }]),
      listStandaloneSkills: () => Promise.resolve([]),
      ...(provider === 'codex' && { uninstallPlugin }),
    });

    const result = await Effect.runPromise(
      new PluginService(factory).uninstallPlugin('codex', 'chrome@bundled'),
    );

    expect(uninstallPlugin).toHaveBeenCalledWith('chrome@bundled', {
      signal: expect.any(AbortSignal),
    });
    expect(result.plugin.installations).toEqual([]);
    expect(result.pendingAuthApps).toBeUndefined();
  });

  it.each(['install', 'uninstall'] as const)(
    'propagates Effect interruption to plugin %s',
    async (operation) => {
      let receivedSignal: AbortSignal | undefined;
      let markStarted: () => void = noop;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const waitForAbort = (opts: PluginDiscoveryOptions | undefined): Promise<void> => {
        if (!opts?.signal) return Promise.reject(new Error('missing signal'));
        receivedSignal = opts.signal;
        markStarted();
        return new Promise((_resolve, reject) => {
          opts.signal?.addEventListener(
            'abort',
            () => reject(new Error('effect interrupted', { cause: opts.signal?.reason })),
            { once: true },
          );
        });
      };
      const factory: PluginProviderAdapterFactory = (provider) => ({
        provider,
        list: () => Promise.resolve([]),
        listStandaloneSkills: () => Promise.resolve([]),
        installPlugin: (id, opts) => waitForAbort(opts).then(() => ({ pendingAuthApps: [id] })),
        uninstallPlugin: (_id, opts) => waitForAbort(opts),
      });
      const service = new PluginService(factory);
      const effect =
        operation === 'install'
          ? service.installPlugin('codex', 'review')
          : service.uninstallPlugin('codex', 'review');
      const fiber = Effect.runFork(effect);
      await started;

      await Effect.runPromise(Fiber.interrupt(fiber));

      expect(receivedSignal?.aborted).toBe(true);
    },
  );

  it('refuses install and uninstall on a provider whose adapter implements neither', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([]),
      listStandaloneSkills: () => Promise.resolve([]),
    });
    const service = new PluginService(factory);

    for (const mutation of [
      service.installPlugin('claude-code', 'any'),
      service.uninstallPlugin('claude-code', 'any'),
    ]) {
      expect(await Effect.runPromise(Effect.flip(mutation))).toMatchObject({
        _tag: 'RequestError',
        code: 'unsupported',
      });
    }
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

  it('rejects managed plugin toggles before invoking the provider', async () => {
    const setPluginEnabled = vi.fn(asyncNoop);
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () =>
        Promise.resolve([
          { ...plugin(provider, 'managed'), installations: [{ enabled: true, scope: 'managed' }] },
        ]),
      listStandaloneSkills: () => Promise.resolve([]),
      setPluginEnabled,
    });

    const outcome = await Effect.runPromise(
      Effect.flip(
        new PluginService(factory).setPluginEnabled('claude-code', 'managed', false, {
          scope: 'managed',
        }),
      ),
    );

    expect(outcome).toMatchObject({ _tag: 'RequestError', code: 'unsupported' });
    expect(setPluginEnabled).not.toHaveBeenCalled();
  });

  it('toggles a skill through the adapter and returns the re-read skill', async () => {
    const setSkillEnabled = vi.fn(asyncNoop);
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([]),
      listStandaloneSkills: () => Promise.resolve([{ ...skill(provider, 'docx'), enabled: false }]),
      ...(provider === 'claude-code' && { setSkillEnabled }),
    });
    const target = { id: 'docx', path: '/skills/docx', scope: 'user' } as const;

    const updated = await Effect.runPromise(
      new PluginService(factory).setSkillEnabled('claude-code', target, false, { cwd: '/repo' }),
    );

    expect(setSkillEnabled).toHaveBeenCalledWith(target, false, { cwd: '/repo' });
    expect(updated).toMatchObject({ id: 'docx', enabled: false });
  });

  it('targets and reads back a standalone skill by exact path when ids collide', async () => {
    const setSkillEnabled = vi.fn(asyncNoop);
    let reads = 0;
    const user = skill('claude-code', 'deploy');
    const project = { ...user, scope: 'project' as const, path: '/repo/.claude/skills/deploy' };
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([]),
      listStandaloneSkills() {
        reads += 1;
        return Promise.resolve([user, { ...project, enabled: reads === 1 }]);
      },
      setSkillEnabled,
    });

    const updated = await Effect.runPromise(
      new PluginService(factory).setSkillEnabled(
        'claude-code',
        { id: 'deploy', path: project.path, scope: 'project' },
        false,
        { cwd: '/repo' },
      ),
    );

    expect(setSkillEnabled).toHaveBeenCalledWith(
      { id: 'deploy', path: project.path, scope: 'project' },
      false,
      { cwd: '/repo' },
    );
    expect(updated).toMatchObject({ path: project.path, scope: 'project', enabled: false });
  });

  it('fails skill toggles with unsupported when the adapter has no mechanism', async () => {
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([]),
      listStandaloneSkills: () => Promise.resolve([]),
    });

    const outcome = await Effect.runPromise(
      Effect.flip(
        new PluginService(factory).setSkillEnabled(
          'codex',
          { id: 'x', path: '/x', scope: 'user' },
          true,
        ),
      ),
    );

    expect(outcome).toMatchObject({ _tag: 'RequestError', code: 'unsupported' });
  });

  it('fails with not_found when the toggled skill never shows up in the readback', async () => {
    // Both providers blind-write, so the re-read is the only proof the toggle landed.
    const factory: PluginProviderAdapterFactory = (provider) => ({
      provider,
      list: () => Promise.resolve([]),
      listStandaloneSkills: () => Promise.resolve([]),
      setSkillEnabled: asyncNoop,
    });

    const outcome = await Effect.runPromise(
      Effect.flip(
        new PluginService(factory).setSkillEnabled(
          'claude-code',
          { id: 'ghost', path: '/ghost', scope: 'user' },
          true,
        ),
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
