import type { LoopId, LoopIteration, LoopRecord } from '@linkcode/schema';
import { LoopIterationSchema, LoopRecordSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createLoopStore } from '../loop-store';

const lid = (id: string): LoopId => id as LoopId;

function makeLoop(value: Record<string, unknown> & { loopId: string }): LoopRecord {
  return LoopRecordSchema.parse({
    spec: {
      kind: 'claude-code',
      cwd: '/repo',
      prompt: 'do it',
      verifyChecks: ['pnpm test'],
      maxIterations: 10,
      sleepMs: 0,
    },
    status: 'running',
    iterationCount: 0,
    startedAt: 1,
    updatedAt: 2,
    ...value,
  });
}

function makeIteration(
  value: Record<string, unknown> & { loopId: string; index: number },
): LoopIteration {
  return LoopIterationSchema.parse({
    status: 'failed',
    checks: [{ command: 'pnpm test', exitCode: 1, outputTail: '1 failing' }],
    startedAt: 100,
    endedAt: 200,
    ...value,
  });
}

describe('daemon sqlite loop store', () => {
  it('round-trips a loop with checks and a verifier spec', async () => {
    const store = createLoopStore(':memory:');
    const withVerifier = makeLoop({
      loopId: 'loop-1',
      spec: {
        name: 'green tests',
        kind: 'claude-code',
        cwd: '/repo',
        prompt: 'fix it',
        verifyChecks: ['pnpm test', 'pnpm lint'],
        verifier: { kind: 'codex', prompt: 'is it green?' },
        maxIterations: 20,
        maxTimeMs: 600000,
        sleepMs: 1000,
        turnTimeoutMs: 300000,
      },
      status: 'succeeded',
      iterationCount: 2,
      summary: 'all green',
      endedAt: 500,
    });
    const minimal = makeLoop({ loopId: 'loop-2' });
    await store.save(withVerifier);
    await store.save(minimal);

    const loaded = (await store.load()).sort((a, b) => a.loopId.localeCompare(b.loopId));
    expect(loaded).toEqual([withVerifier, minimal]);
  });

  it('upserts a loop in place', async () => {
    const store = createLoopStore(':memory:');
    await store.save(makeLoop({ loopId: 'loop-1' }));
    await store.save(makeLoop({ loopId: 'loop-1', status: 'stopped', error: 'stopped by user' }));
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].status).toBe('stopped');
    expect(loaded[0].error).toBe('stopped by user');
  });

  it('stores iterations oldest-first and finds running loops', async () => {
    const store = createLoopStore(':memory:');
    await store.save(makeLoop({ loopId: 'loop-1' }));
    await store.save(makeLoop({ loopId: 'loop-2', status: 'succeeded' }));
    await store.saveIteration(makeIteration({ loopId: 'loop-1', index: 1 }));
    await store.saveIteration(makeIteration({ loopId: 'loop-1', index: 0 }));

    const iterations = await store.loadIterations(lid('loop-1'));
    expect(iterations.map((it) => it.index)).toEqual([0, 1]);
    const running = await store.loadRunning();
    expect(running.map((l) => l.loopId)).toEqual(['loop-1']);
  });

  it('upserts an iteration by (loopId, index)', async () => {
    const store = createLoopStore(':memory:');
    await store.save(makeLoop({ loopId: 'loop-1' }));
    await store.saveIteration(makeIteration({ loopId: 'loop-1', index: 0 }));
    await store.saveIteration(
      makeIteration({
        loopId: 'loop-1',
        index: 0,
        status: 'passed',
        verdict: { passed: true, reason: 'ok' },
      }),
    );
    const iterations = await store.loadIterations(lid('loop-1'));
    expect(iterations).toHaveLength(1);
    expect(iterations[0].status).toBe('passed');
    expect(iterations[0].verdict).toEqual({ passed: true, reason: 'ok' });
  });

  it('cascades iteration deletion when a loop is deleted', async () => {
    const store = createLoopStore(':memory:');
    await store.save(makeLoop({ loopId: 'loop-1' }));
    await store.saveIteration(makeIteration({ loopId: 'loop-1', index: 0 }));
    await store.delete(lid('loop-1'));
    expect(await store.load()).toHaveLength(0);
    expect(await store.loadIterations(lid('loop-1'))).toHaveLength(0);
  });
});
