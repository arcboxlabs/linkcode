import type { LoopRecord, LoopStatus } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { buildLoopItems } from '../items';

function loop(opts: {
  loopId: string;
  status?: LoopStatus;
  updatedAt?: number;
  name?: string;
  prompt?: string;
}): LoopRecord {
  return {
    loopId: opts.loopId as LoopRecord['loopId'],
    spec: {
      name: opts.name,
      kind: 'claude-code',
      cwd: '/repo',
      prompt: opts.prompt ?? 'do it',
      verifyChecks: ['pnpm test'],
      maxIterations: 10,
      sleepMs: 0,
    },
    status: opts.status ?? 'running',
    iterationCount: 0,
    startedAt: 0,
    updatedAt: opts.updatedAt ?? 0,
  };
}

describe('buildLoopItems', () => {
  it('orders running first, then failed/succeeded/stopped, then by updatedAt desc', () => {
    const items = buildLoopItems([
      loop({ loopId: 'a', status: 'stopped', updatedAt: 100 }),
      loop({ loopId: 'b', status: 'running', updatedAt: 10 }),
      loop({ loopId: 'c', status: 'running', updatedAt: 20 }),
      loop({ loopId: 'd', status: 'failed', updatedAt: 50 }),
      loop({ loopId: 'e', status: 'succeeded', updatedAt: 5 }),
    ]);
    expect(items.map((i) => i.loopId)).toEqual(['c', 'b', 'd', 'e', 'a']);
  });

  it('names by the loop name, falling back to a prompt excerpt', () => {
    const named = buildLoopItems([loop({ loopId: 'a', name: 'Green the suite' })]);
    expect(named[0].name).toBe('Green the suite');

    const excerpt = buildLoopItems([loop({ loopId: 'b', prompt: 'x'.repeat(100) })]);
    expect(excerpt[0].name).toHaveLength(60);
    expect(excerpt[0].name.endsWith('…')).toBe(true);
  });

  it('returns an empty list for undefined', () => {
    expect(buildLoopItems(undefined)).toEqual([]);
  });
});
