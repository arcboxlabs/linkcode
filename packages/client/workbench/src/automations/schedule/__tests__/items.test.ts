import type { Schedule, ScheduleStatus } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { buildScheduleItems } from '../items';

function schedule(opts: {
  scheduleId: string;
  status?: ScheduleStatus;
  updatedAt?: number;
  name?: string;
  prompt?: string;
}): Schedule {
  return {
    scheduleId: opts.scheduleId as Schedule['scheduleId'],
    spec: {
      name: opts.name,
      prompt: opts.prompt ?? 'do it',
      cadence: { type: 'interval', everyMs: 60_000 },
      target: { type: 'new-session', config: { kind: 'claude-code', cwd: '/repo' } },
    },
    status: opts.status ?? 'active',
    runCount: 0,
    createdAt: 0,
    updatedAt: opts.updatedAt ?? 0,
  };
}

describe('buildScheduleItems', () => {
  it('orders schedules by status, then by updatedAt desc', () => {
    const items = buildScheduleItems([
      schedule({ scheduleId: 'a', status: 'completed', updatedAt: 100 }),
      schedule({ scheduleId: 'b', status: 'active', updatedAt: 10 }),
      schedule({ scheduleId: 'c', status: 'active', updatedAt: 20 }),
      schedule({ scheduleId: 'd', status: 'paused', updatedAt: 50 }),
    ]);
    expect(items.map((i) => i.scheduleId)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('names by the schedule name, falling back to a prompt excerpt', () => {
    const named = buildScheduleItems([schedule({ scheduleId: 'a', name: 'Nightly digest' })]);
    expect(named[0].name).toBe('Nightly digest');

    const excerpt = buildScheduleItems([schedule({ scheduleId: 'b', prompt: 'x'.repeat(100) })]);
    expect(excerpt[0].name).toHaveLength(60);
    expect(excerpt[0].name.endsWith('…')).toBe(true);
  });

  it('returns an empty list for undefined', () => {
    expect(buildScheduleItems(undefined)).toEqual([]);
  });
});
