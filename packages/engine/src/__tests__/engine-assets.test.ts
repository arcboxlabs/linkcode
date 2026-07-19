import type {
  AgentRuntimes,
  AssetInstallEvent,
  InstalledAsset,
  ManagedAssetStatus,
  ValidatedWireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { AssetService } from '../asset/service';
import type { EngineDeps } from '../engine';
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
  let handler: ((msg: ValidatedWireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: ValidatedWireMessage) {
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

  it('stops forwarding install events after the engine shuts down', async () => {
    const { service, emit } = fakeAssets();
    const { engine, sent } = harness({ assets: service });
    await engine.start();
    await engine.stop();

    emit({ kind: 'failed', id: 'agent:codex', error: 'network down' });

    expect(sent).not.toContainEqual({
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

  it('pushes agent-runtime.changed for an agent install even when the snapshot is unchanged', async () => {
    // Clients treat the push as the install's settle signal, so an event-triggered re-probe must
    // broadcast even a byte-identical result — unlike the diff-gated read-triggered revalidation.
    const runtimes: AgentRuntimes = {
      codex: { status: 'available', source: 'managed', path: INSTALLED_CODEX.path },
    };
    const { service, emit } = fakeAssets();
    const { engine, sent } = harness({
      assets: service,
      agentRuntimes: runtimes,
      collectAgentRuntimes: () => Promise.resolve(runtimes),
    });
    await engine.start();
    emit({ kind: 'installed', id: 'agent:codex', installed: INSTALLED_CODEX });
    await vi.waitFor(() => {
      expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes });
    });
  });

  it('queues an event re-probe behind an in-flight read revalidation', async () => {
    // The read-triggered pass may have probed before the install landed on disk; the event's own
    // pass must run after it so the pushed snapshot reflects the install.
    const boot: AgentRuntimes = { codex: { status: 'missing' } };
    const refreshed: AgentRuntimes = {
      codex: { status: 'available', source: 'managed', path: INSTALLED_CODEX.path },
    };
    const resolvers: Array<(runtimes: AgentRuntimes) => void> = [];
    const collect = vi.fn(
      () =>
        new Promise<AgentRuntimes>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { service, emit } = fakeAssets();
    const { engine, sent, inject } = harness({
      assets: service,
      agentRuntimes: boot,
      collectAgentRuntimes: collect,
    });
    await engine.start();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' }); // pass 1: read-triggered
    emit({ kind: 'installed', id: 'agent:codex', installed: INSTALLED_CODEX }); // pass 2: queued
    await vi.waitFor(() => {
      expect(collect).toHaveBeenCalledTimes(1); // pass 2 must NOT start while pass 1 is in flight
    });

    nullthrow(resolvers[0])(boot); // pass 1 sees the pre-install truth — unchanged, no push
    await vi.waitFor(() => {
      expect(collect).toHaveBeenCalledTimes(2);
    });
    nullthrow(resolvers[1])(refreshed);
    await vi.waitFor(() => {
      expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: refreshed });
    });
    expect(sent.filter((p) => p.kind === 'agent-runtime.changed')).toHaveLength(1);
  });

  it('an install event re-probes straight through the read-revalidation cooldown', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const runtimes: AgentRuntimes = { codex: { status: 'missing' } };
      const collect = vi.fn(() => Promise.resolve(runtimes));
      const { service, emit } = fakeAssets();
      const { engine, inject } = harness({
        assets: service,
        agentRuntimes: runtimes,
        collectAgentRuntimes: collect,
      });
      await engine.start();

      inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
      await vi.waitFor(() => {
        expect(collect).toHaveBeenCalledTimes(1);
      });
      inject({ kind: 'agent-runtime.list', clientReqId: 'r2' }); // cooldown active → skipped
      await vi.waitFor(() => {
        expect(collect).toHaveBeenCalledTimes(1);
      });

      // The event path must not inherit the read cooldown: the client's 'installed' activity
      // bridge waits on this push landing promptly.
      emit({ kind: 'installed', id: 'agent:codex', installed: INSTALLED_CODEX });
      await vi.waitFor(() => {
        expect(collect).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('coalesces simultaneous install events onto one queued pass', async () => {
    const runtimes: AgentRuntimes = {
      codex: { status: 'available', source: 'managed', path: INSTALLED_CODEX.path },
    };
    const collect = vi.fn(() => Promise.resolve(runtimes));
    const { service, emit } = fakeAssets();
    const { engine, sent } = harness({
      assets: service,
      agentRuntimes: {},
      collectAgentRuntimes: collect,
    });
    await engine.start();

    // Same tick, before the queued pass starts probing: both events' effects are already on
    // disk, so one pass observes them both.
    emit({ kind: 'installed', id: 'agent:codex', installed: INSTALLED_CODEX });
    emit({ kind: 'installed', id: 'agent:claude-code', installed: INSTALLED_CODEX });
    await vi.waitFor(() => {
      expect(sent.filter((p) => p.kind === 'agent-runtime.changed')).toHaveLength(1);
    });
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('does not join an event onto a pass that is already probing', async () => {
    const runtimes: AgentRuntimes = {
      codex: { status: 'available', source: 'managed', path: INSTALLED_CODEX.path },
    };
    const resolvers: Array<(value: AgentRuntimes) => void> = [];
    const collect = vi.fn(
      () =>
        new Promise<AgentRuntimes>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { service, emit } = fakeAssets();
    const { engine, sent } = harness({
      assets: service,
      agentRuntimes: {},
      collectAgentRuntimes: collect,
    });
    await engine.start();

    emit({ kind: 'installed', id: 'agent:codex', installed: INSTALLED_CODEX });
    await vi.waitFor(() => {
      expect(collect).toHaveBeenCalledTimes(1); // pass 1 is probing now
    });
    // This event's install landed after pass 1 began — it needs its own pass.
    emit({ kind: 'installed', id: 'agent:claude-code', installed: INSTALLED_CODEX });
    nullthrow(resolvers[0])(runtimes);
    await vi.waitFor(() => {
      expect(collect).toHaveBeenCalledTimes(2);
    });
    nullthrow(resolvers[1])(runtimes);
    await vi.waitFor(() => {
      expect(sent.filter((p) => p.kind === 'agent-runtime.changed')).toHaveLength(2);
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
