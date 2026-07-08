import type {
  AgentRuntimes,
  AssetInstallEvent,
  InstalledAsset,
  ManagedAssetStatus,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { AssetService, EngineDeps } from '../engine';
import { Engine } from '../engine';

const INSTALLED_CODEX: InstalledAsset = {
  id: 'agent:codex',
  version: '0.140.0',
  path: '/store/agent/codex/0.140.0/codex',
};

/** A controllable AssetService: tests emit lifecycle events and settle ensure() by hand. */
function fakeAssets(overrides: Partial<AssetService> = {}) {
  const listeners = new Set<(event: AssetInstallEvent) => void>();
  const service: AssetService = {
    statuses: () => [],
    ensure: () => Promise.resolve(INSTALLED_CODEX),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...overrides,
  };
  const emit = (event: AssetInstallEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { service, emit };
}

function harness(deps: EngineDeps = {}) {
  const sent: WirePayload[] = [];
  let handler: ((msg: WireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const engine = new Engine(transport, deps);
  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  return { engine, sent, inject };
}

describe('asset.list', () => {
  it('serves a live status snapshot from the injected service', async () => {
    const statuses: ManagedAssetStatus[] = [
      {
        id: 'agent:codex',
        wantedVersion: '0.140.0',
        installed: {
          id: 'agent:codex',
          version: '0.140.0',
          path: '/store/agent/codex/0.140.0/codex',
        },
      },
      { id: 'tool:tectonic', wantedVersion: '0.16.9' },
    ];
    const { service } = fakeAssets({ statuses: () => statuses });
    const { engine, sent, inject } = harness({ assets: service });
    await engine.start();
    inject({ kind: 'asset.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'asset.listed', replyTo: 'r1', assets: statuses });
  });

  it('serves an empty list when the host injected no asset service', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({ kind: 'asset.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'asset.listed', replyTo: 'r1', assets: [] });
  });
});

describe('asset.ensure', () => {
  it('replies asset.ensured with the fresh status once the install settles', async () => {
    const status: ManagedAssetStatus = {
      id: 'agent:codex',
      wantedVersion: '0.140.0',
      installed: INSTALLED_CODEX,
    };
    const { service } = fakeAssets({ statuses: () => [status] });
    const { engine, sent, inject } = harness({ assets: service });
    await engine.start();
    inject({ kind: 'asset.ensure', clientReqId: 'r1', id: 'agent:codex' });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({ kind: 'asset.ensured', replyTo: 'r1', status });
    });
  });

  it('fails the request when the install rejects', async () => {
    const { service } = fakeAssets({ ensure: () => Promise.reject(new Error('boom')) });
    const { engine, sent, inject } = harness({ assets: service });
    await engine.start();
    inject({ kind: 'asset.ensure', clientReqId: 'r1', id: 'agent:codex' });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'request.failed',
        replyTo: 'r1',
        message: 'Error: boom',
      });
    });
  });

  it('fails the request when the asset cannot be pinned (ensure resolves undefined)', async () => {
    const { service } = fakeAssets({ ensure: () => Promise.resolve(undefined) });
    const { engine, sent, inject } = harness({ assets: service });
    await engine.start();
    inject({ kind: 'asset.ensure', clientReqId: 'r1', id: 'agent:opencode' });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        kind: 'request.failed',
        replyTo: 'r1',
        message: 'Error: asset agent:opencode cannot be installed here',
      });
    });
  });

  it('fails the request when the host has no asset service', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({ kind: 'asset.ensure', clientReqId: 'r1', id: 'agent:codex' });
    expect(sent).toContainEqual({
      kind: 'request.failed',
      replyTo: 'r1',
      message: 'Error: managed assets are unavailable on this host',
    });
  });
});

describe('asset install broadcasts', () => {
  it('forwards progress (throttled per asset) and clears the throttle on settle', () => {
    vi.useFakeTimers();
    try {
      const { service, emit } = fakeAssets();
      const { sent } = harness({ assets: service });

      emit({ kind: 'progress', id: 'agent:codex', receivedBytes: 1, totalBytes: 100 });
      emit({ kind: 'progress', id: 'agent:codex', receivedBytes: 2, totalBytes: 100 });
      // Another asset has its own throttle window.
      emit({ kind: 'progress', id: 'tool:tectonic', receivedBytes: 5 });
      vi.advanceTimersByTime(200);
      emit({ kind: 'progress', id: 'agent:codex', receivedBytes: 3, totalBytes: 100 });

      expect(sent.filter((p) => p.kind === 'asset.progress')).toEqual([
        { kind: 'asset.progress', id: 'agent:codex', receivedBytes: 1, totalBytes: 100 },
        { kind: 'asset.progress', id: 'tool:tectonic', receivedBytes: 5, totalBytes: undefined },
        { kind: 'asset.progress', id: 'agent:codex', receivedBytes: 3, totalBytes: 100 },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('broadcasts asset.settled with the error when an install fails', () => {
    const { service, emit } = fakeAssets();
    const { sent } = harness({ assets: service });
    emit({ kind: 'failed', id: 'agent:codex', error: 'network down' });
    expect(sent).toContainEqual({
      kind: 'asset.settled',
      id: 'agent:codex',
      error: 'network down',
    });
  });

  it('on agent install: broadcasts asset.settled, re-probes, and pushes agent-runtime.changed', async () => {
    const refreshed: AgentRuntimes = {
      codex: { status: 'available', source: 'managed', path: INSTALLED_CODEX.path },
    };
    const { service, emit } = fakeAssets();
    const { engine, sent, inject } = harness({
      assets: service,
      agentRuntimes: { codex: { status: 'missing' } },
      collectAgentRuntimes: () => Promise.resolve(refreshed),
    });
    await engine.start();

    emit({ kind: 'installed', id: 'agent:codex', installed: INSTALLED_CODEX });
    expect(sent).toContainEqual({
      kind: 'asset.settled',
      id: 'agent:codex',
      installed: INSTALLED_CODEX,
    });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: refreshed });
    });

    // The pull path serves the refreshed snapshot from now on.
    inject({ kind: 'agent-runtime.list', clientReqId: 'r2' });
    expect(sent).toContainEqual({
      kind: 'agent-runtime.listed',
      replyTo: 'r2',
      runtimes: refreshed,
    });
  });

  it('does not re-probe for tool installs', async () => {
    const collect = vi.fn(() => Promise.resolve({}));
    const { service, emit } = fakeAssets();
    harness({ assets: service, collectAgentRuntimes: collect });
    emit({
      kind: 'installed',
      id: 'tool:tectonic',
      installed: { id: 'tool:tectonic', version: '0.16.9', path: '/store/tool/tectonic' },
    });
    await Promise.resolve();
    expect(collect).not.toHaveBeenCalled();
  });
});
