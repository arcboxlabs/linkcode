import type { AssetService } from '@linkcode/engine';
import type { AgentRuntimes, InstalledAsset, ManagedAssetId } from '@linkcode/schema';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { filterAgentRuntimes, restrictedAssetService } from '../agent-restrictions';

describe('filterAgentRuntimes', () => {
  const runtimes: AgentRuntimes = {
    'claude-code': { status: 'available', source: 'detected', path: '/usr/bin/claude' },
    codex: { status: 'available', source: 'sdk' },
    pi: { status: 'missing' },
  };

  it('returns the runtimes unchanged when unrestricted', () => {
    expect(filterAgentRuntimes(runtimes, null)).toBe(runtimes);
  });

  it('reports a disallowed kind as missing regardless of how it was actually probed', () => {
    const filtered = filterAgentRuntimes(runtimes, ['pi']);
    expect(filtered['claude-code']).toEqual({ status: 'missing' });
    expect(filtered.codex).toEqual({ status: 'missing' });
    expect(filtered.pi).toEqual({ status: 'missing' });
  });

  it('leaves an allowed kind exactly as probed', () => {
    const filtered = filterAgentRuntimes(runtimes, ['claude-code']);
    expect(filtered['claude-code']).toBe(runtimes['claude-code']);
  });
});

describe('restrictedAssetService', () => {
  // Mocks kept as loose locals rather than read back off the typed `AssetService` — asserting via
  // `assets.ensure` would reference an interface method (unbound-method lint) for no benefit here.
  function fakeAssets(): {
    assets: AssetService;
    ensure: ReturnType<typeof vi.fn>;
    statuses: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  } {
    const ensure = vi.fn(
      (id: ManagedAssetId): Promise<InstalledAsset> =>
        Promise.resolve({ id, version: '1.0.0', path: '/tmp/asset' }),
    );
    const statuses = vi.fn(() => []);
    const subscribe = vi.fn(() => noop);
    return { assets: { statuses, subscribe, ensure }, ensure, statuses, subscribe };
  }

  it('returns the asset service unchanged when unrestricted', () => {
    const { assets } = fakeAssets();
    expect(restrictedAssetService(assets, null)).toBe(assets);
  });

  it('refuses to ensure a disallowed agent asset without touching the underlying store', async () => {
    const { assets, ensure } = fakeAssets();
    const restricted = restrictedAssetService(assets, ['pi']);

    const installed = await restricted.ensure({ kind: 'agent', name: 'codex' });

    expect(installed).toBeUndefined();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('passes an allowed agent asset through to the underlying store', async () => {
    const { assets, ensure } = fakeAssets();
    const restricted = restrictedAssetService(assets, ['pi']);

    await restricted.ensure({ kind: 'agent', name: 'pi' });

    expect(ensure).toHaveBeenCalledWith({ kind: 'agent', name: 'pi' });
  });

  it('never agent-gates a tool asset', async () => {
    const { assets, ensure } = fakeAssets();
    const restricted = restrictedAssetService(assets, ['pi']);

    await restricted.ensure({ kind: 'tool', name: 'aigateway' });

    expect(ensure).toHaveBeenCalledWith({ kind: 'tool', name: 'aigateway' });
  });

  it('hides a disallowed agent asset from statuses()', () => {
    const { assets, statuses } = fakeAssets();
    statuses.mockReturnValue([
      { id: { kind: 'agent', name: 'codex' } },
      { id: { kind: 'agent', name: 'pi' } },
      { id: { kind: 'tool', name: 'aigateway' } },
    ]);
    const restricted = restrictedAssetService(assets, ['pi']);

    expect(restricted.statuses().map(({ id }) => id)).toEqual([
      { kind: 'agent', name: 'pi' },
      { kind: 'tool', name: 'aigateway' },
    ]);
  });

  it('drops a disallowed agent asset from subscribe() events', () => {
    const { assets, subscribe } = fakeAssets();
    let emit: ((event: unknown) => void) | undefined;
    subscribe.mockImplementation((listener: (event: unknown) => void) => {
      emit = listener;
      return noop;
    });
    const restricted = restrictedAssetService(assets, ['pi']);
    const listener = vi.fn();
    restricted.subscribe(listener);

    emit?.({ kind: 'failed', id: { kind: 'agent', name: 'codex' }, error: 'x' });
    emit?.({ kind: 'failed', id: { kind: 'agent', name: 'pi' }, error: 'x' });
    emit?.({ kind: 'failed', id: { kind: 'tool', name: 'aigateway' }, error: 'x' });

    expect(listener.mock.calls.map(([event]) => (event as { id: ManagedAssetId }).id)).toEqual([
      { kind: 'agent', name: 'pi' },
      { kind: 'tool', name: 'aigateway' },
    ]);
  });
});
