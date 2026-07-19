import { AUTH_FAILED_ERROR_CODE } from '@linkcode/agent-adapter';
import type { AgentRuntimes } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it, vi } from 'vitest';
import { InMemorySessionStore } from '../session/session-store';
import {
  createSessionHarness,
  settleEngineTasks,
  startedSessionId,
} from './fixtures/session-harness';

describe('auth-failure re-probe', () => {
  it('re-probes runtimes on an authentication-failure error, but not on other errors', async () => {
    const signedOut: AgentRuntimes = {
      'claude-code': { status: 'available', source: 'detected', auth: { loggedIn: false } },
    };
    const collect = vi.fn(() => Promise.resolve(signedOut));
    const { engine, sent, inject, adapters } = createSessionHarness(undefined, undefined, collect);
    await engine.start();
    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const adapter = nullthrow(adapters[0], 'no adapter started');

    adapter.emit({
      type: 'error',
      message: 'Claude authentication failed',
      code: AUTH_FAILED_ERROR_CODE,
      recoverable: false,
    });
    await settleEngineTasks();
    expect(collect).toHaveBeenCalledOnce();
    expect(sent).toContainEqual({ kind: 'agent-runtime.changed', runtimes: signedOut });

    // A generic (non-auth) error must not trigger a re-probe.
    adapter.emit({ type: 'error', message: 'boom', recoverable: true });
    await settleEngineTasks();
    expect(collect).toHaveBeenCalledOnce();
  });
});

describe('boot probe gating (CODE-225)', () => {
  it('holds a live session start until the boot probe lands', async () => {
    let resolveProbe!: (runtimes: AgentRuntimes) => void;
    const ready = new Promise<AgentRuntimes>((resolve) => {
      resolveProbe = resolve;
    });
    const { engine, sent, inject, adapters } = createSessionHarness(
      undefined,
      undefined,
      undefined,
      ready,
    );
    await engine.start();

    await inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    // Registered but not started: spawn-path resolution reads the probe's detection state.
    expect(adapters).toHaveLength(1);
    expect(adapters[0].startedWith).toBeNull();
    expect(sent.filter((payload) => payload.kind === 'session.started')).toEqual([]);

    resolveProbe({ pi: { status: 'available', source: 'builtin' } });
    await settleEngineTasks();
    expect(adapters[0].startedWith).not.toBeNull();
    expect(startedSessionId(sent, 'r1')).toBeTruthy();
  });

  it('a session deleted while waiting for the probe is not resurrected by the pending start', async () => {
    const store = new InMemorySessionStore();
    // Cold record made under an engine with no pending probe.
    const warm = createSessionHarness(store);
    await warm.engine.start();
    await warm.inject({
      kind: 'session.start',
      clientReqId: 'r1',
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    const sessionId = startedSessionId(warm.sent, 'r1');
    await warm.inject({ kind: 'session.stop', clientReqId: 'r2', sessionId });

    let resolveProbe!: (runtimes: AgentRuntimes) => void;
    const ready = new Promise<AgentRuntimes>((resolve) => {
      resolveProbe = resolve;
    });
    const cold = createSessionHarness(store, undefined, undefined, ready);
    await cold.engine.start();

    await cold.inject({ kind: 'session.resume', clientReqId: 'r3', sessionId });
    await cold.inject({ kind: 'session.delete', clientReqId: 'r4', sessionId });
    expect(cold.sent).toContainEqual({ kind: 'request.succeeded', replyTo: 'r4' });

    resolveProbe({ pi: { status: 'available', source: 'builtin' } });
    await settleEngineTasks();
    const failed = cold.sent.find(
      (payload) => payload.kind === 'request.failed' && payload.replyTo === 'r3',
    );
    if (failed?.kind !== 'request.failed') throw new Error('no request.failed for r3');
    expect(failed.message).toContain('closed while starting');
    expect(
      cold.sent.filter((payload) => payload.kind === 'session.started' && payload.replyTo === 'r3'),
    ).toEqual([]);
    expect(await store.load()).toEqual([]);
    expect(cold.adapters[0].startedWith).toBeNull();
    expect(cold.adapters[0].stopped).toBe(true);
  });
});
