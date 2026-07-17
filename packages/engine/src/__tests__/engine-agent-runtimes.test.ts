import type { AgentRuntimes, WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../engine';

function harness(
  agentRuntimes?: AgentRuntimes,
  collectAgentRuntimes?: () => Promise<AgentRuntimes>,
  agentRuntimesReady?: Promise<AgentRuntimes>,
) {
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
  const engine = new Engine(transport, { agentRuntimes, collectAgentRuntimes, agentRuntimesReady });
  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  return { engine, sent, inject };
}

/** Settles the fire-and-forget revalidation pass: one macrotask outlasts its microtask chain. */
const flushBackground = (): Promise<void> => wait(0);

describe('agent-runtime.list', () => {
  it('serves the boot-time probe result', async () => {
    const runtimes: AgentRuntimes = {
      'claude-code': {
        status: 'available',
        source: 'detected',
        path: '/x/claude',
        version: '2.1.202',
      },
      pi: { status: 'available', source: 'builtin' },
    };
    const { engine, sent, inject } = harness(runtimes);
    await engine.start();
    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes });
  });

  it('serves an empty record when the host injected none', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes: {} });
  });
});

describe('agent-runtime.list revalidation (CODE-172)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const boot: AgentRuntimes = {
    pi: { status: 'available', source: 'builtin' },
    'claude-code': {
      status: 'available',
      source: 'detected',
      path: '/x/claude',
      version: '2.1.202',
      auth: { loggedIn: true },
    },
  };

  it('re-probes in the background and pushes a differing snapshot', async () => {
    const fresh: AgentRuntimes = {
      ...boot,
      'claude-code': { ...nullthrow(boot['claude-code']), auth: { loggedIn: false } },
    };
    const collect = vi.fn(() => Promise.resolve(fresh));
    const { engine, sent, inject } = harness(boot, collect);
    await engine.start();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    // The read itself is answered synchronously from the stale snapshot…
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes: boot });
    // …and the background pass pushes the differing re-probe result.
    await flushBackground();
    expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: fresh });
    expect(collect).toHaveBeenCalledTimes(1);

    // Later reads serve the refreshed snapshot.
    inject({ kind: 'agent-runtime.list', clientReqId: 'r2' });
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r2', runtimes: fresh });
  });

  it('suppresses the push when the re-probe matches, even with reordered keys', async () => {
    // Same content as `boot`, different key insertion order at both depths — the collector builds
    // its record from concurrently-resolving probes, so order is not a signal.
    const reordered: AgentRuntimes = {
      'claude-code': {
        auth: { loggedIn: true },
        version: '2.1.202',
        path: '/x/claude',
        source: 'detected',
        status: 'available',
      },
      pi: { source: 'builtin', status: 'available' },
    };
    const { engine, sent, inject } = harness(boot, () => Promise.resolve(reordered));
    await engine.start();
    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    await flushBackground();
    expect(sent.filter((p) => p.kind === 'agent-runtime.changed')).toEqual([]);
  });

  it('coalesces reads onto an in-flight pass and rate-limits follow-ups', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const collect = vi.fn(() => Promise.resolve(boot));
    const { engine, inject } = harness(boot, collect);
    await engine.start();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    inject({ kind: 'agent-runtime.list', clientReqId: 'r2' }); // in flight → coalesced
    await flushBackground();
    expect(collect).toHaveBeenCalledTimes(1);

    inject({ kind: 'agent-runtime.list', clientReqId: 'r3' }); // inside the cooldown → skipped
    await flushBackground();
    expect(collect).toHaveBeenCalledTimes(1);

    now += 6000;
    inject({ kind: 'agent-runtime.list', clientReqId: 'r4' }); // cooldown elapsed → re-probes
    await flushBackground();
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it('skips revalidation entirely when the host injected no collect hook', async () => {
    const { engine, sent, inject } = harness(boot);
    await engine.start();
    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    await flushBackground();
    expect(sent.filter((p) => p.kind === 'agent-runtime.changed')).toEqual([]);
  });

  it('a failed pass consumes no cooldown — the next read retries immediately', async () => {
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fresh: AgentRuntimes = {
      ...boot,
      'claude-code': { ...nullthrow(boot['claude-code']), auth: { loggedIn: false } },
    };
    let calls = 0;
    const { engine, sent, inject } = harness(boot, () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('probe died')) : Promise.resolve(fresh);
    });
    await engine.start();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' }); // pass rejects
    await flushBackground();
    expect(sent.filter((p) => p.kind === 'agent-runtime.changed')).toEqual([]);

    // Same instant (well inside the 5s window): the failure must not have armed the cooldown,
    // and the active-pass counter must have unwound, or this read could never re-probe.
    inject({ kind: 'agent-runtime.list', clientReqId: 'r2' });
    await flushBackground();
    expect(calls).toBe(2);
    expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: fresh });
  });
});

describe('boot probe seeding (CODE-225)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const probed: AgentRuntimes = {
    pi: { status: 'available', source: 'builtin' },
    'claude-code': {
      status: 'available',
      source: 'detected',
      path: '/x/claude',
      version: '2.1.202',
    },
  };

  it('holds agent-runtime.list until the boot probe lands, then serves the probed snapshot', async () => {
    let resolveProbe!: (runtimes: AgentRuntimes) => void;
    const ready = new Promise<AgentRuntimes>((resolve) => {
      resolveProbe = resolve;
    });
    const { engine, sent, inject } = harness(undefined, undefined, ready);
    await engine.start();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    await flushBackground();
    expect(sent.filter((p) => p.kind === 'agent-runtime.listed')).toEqual([]);

    resolveProbe(probed);
    await flushBackground();
    expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: probed });
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes: probed });
  });

  it('a read right after the seed rides the seed cooldown instead of re-probing', async () => {
    const collect = vi.fn(() => Promise.resolve(probed));
    const { engine, sent, inject } = harness(undefined, collect, Promise.resolve(probed));
    await engine.start();
    await flushBackground();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    await flushBackground();
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes: probed });
    expect(collect).not.toHaveBeenCalled();
  });

  it('a failed boot probe unblocks reads without arming the cooldown', async () => {
    vi.spyOn(console, 'error').mockImplementation(noop);
    const collect = vi.fn(() => Promise.resolve(probed));
    const { engine, sent, inject } = harness(
      undefined,
      collect,
      Promise.reject(new Error('probe died')),
    );
    await engine.start();
    await flushBackground();

    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    // Unseeded snapshot is served rather than hanging the read forever…
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes: {} });
    // …and the unarmed cooldown lets the read-triggered revalidation retry immediately.
    await flushBackground();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: probed });
  });
});
