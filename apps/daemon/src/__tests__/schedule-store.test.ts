import type { Schedule, ScheduleId, ScheduleRun } from '@linkcode/schema';
import { ScheduleRunSchema, ScheduleSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createScheduleStore } from '../schedule-store';

const sid = (id: string): ScheduleId => id as ScheduleId;

function makeSchedule(value: Record<string, unknown> & { scheduleId: string }): Schedule {
  return ScheduleSchema.parse({
    spec: {
      prompt: 'do it',
      cadence: { type: 'interval', everyMs: 60000 },
      target: { type: 'new-session', config: { kind: 'claude-code', cwd: '/repo' } },
    },
    status: 'active',
    nextRunAt: 1000,
    runCount: 0,
    createdAt: 1,
    updatedAt: 2,
    ...value,
  });
}

function makeRun(
  value: Record<string, unknown> & { runId: string; scheduleId: string },
): ScheduleRun {
  return ScheduleRunSchema.parse({
    status: 'succeeded',
    trigger: 'cadence',
    startedAt: 100,
    endedAt: 200,
    ...value,
  });
}

describe('daemon sqlite schedule store', () => {
  it('round-trips cron and interval schedules with both target kinds', async () => {
    const store = createScheduleStore(':memory:');
    const cronSessionTarget = makeSchedule({
      scheduleId: 'sch-cron',
      spec: {
        name: 'daily digest',
        prompt: 'summarize',
        cadence: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
        target: { type: 'session', sessionId: 'sess-1' },
        maxRuns: 5,
        expiresAt: 999999,
      },
      completedReason: undefined,
    });
    const intervalNewSession = makeSchedule({ scheduleId: 'sch-interval' });
    await store.save(cronSessionTarget);
    await store.save(intervalNewSession);

    const loaded = (await store.load()).sort((a, b) => a.scheduleId.localeCompare(b.scheduleId));
    expect(loaded).toEqual([cronSessionTarget, intervalNewSession]);
  });

  it('upserts a schedule in place', async () => {
    const store = createScheduleStore(':memory:');
    await store.save(makeSchedule({ scheduleId: 'sch-1' }));
    await store.save(makeSchedule({ scheduleId: 'sch-1', status: 'paused', nextRunAt: undefined }));
    const loaded = await store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].status).toBe('paused');
  });

  it('stores runs newest-first, honors limit, and finds running runs', async () => {
    const store = createScheduleStore(':memory:');
    await store.save(makeSchedule({ scheduleId: 'sch-1' }));
    await store.saveRun(makeRun({ runId: 'r1', scheduleId: 'sch-1', startedAt: 100 }));
    await store.saveRun(makeRun({ runId: 'r2', scheduleId: 'sch-1', startedAt: 300 }));
    await store.saveRun(
      makeRun({
        runId: 'r3',
        scheduleId: 'sch-1',
        startedAt: 200,
        status: 'running',
        endedAt: undefined,
      }),
    );

    const all = await store.loadRuns(sid('sch-1'));
    expect(all.map((r) => r.runId)).toEqual(['r2', 'r3', 'r1']);
    const top = await store.loadRuns(sid('sch-1'), 1);
    expect(top.map((r) => r.runId)).toEqual(['r2']);
    const running = await store.loadRunningRuns();
    expect(running.map((r) => r.runId)).toEqual(['r3']);
  });

  it('upserts a run by id and prunes to the newest kept', async () => {
    const store = createScheduleStore(':memory:');
    await store.save(makeSchedule({ scheduleId: 'sch-1' }));
    await store.saveRun(makeRun({ runId: 'r1', scheduleId: 'sch-1', startedAt: 100 }));
    await store.saveRun(
      makeRun({ runId: 'r1', scheduleId: 'sch-1', startedAt: 100, summary: 'updated' }),
    );
    expect(await store.loadRuns(sid('sch-1'))).toHaveLength(1);
    expect((await store.loadRuns(sid('sch-1')))[0].summary).toBe('updated');

    await store.saveRun(makeRun({ runId: 'r2', scheduleId: 'sch-1', startedAt: 300 }));
    await store.saveRun(makeRun({ runId: 'r3', scheduleId: 'sch-1', startedAt: 200 }));
    await store.pruneRuns(sid('sch-1'), 1);
    expect((await store.loadRuns(sid('sch-1'))).map((r) => r.runId)).toEqual(['r2']);
  });

  it('cascades run deletion when a schedule is deleted', async () => {
    const store = createScheduleStore(':memory:');
    await store.save(makeSchedule({ scheduleId: 'sch-1' }));
    await store.saveRun(makeRun({ runId: 'r1', scheduleId: 'sch-1' }));
    await store.delete(sid('sch-1'));
    expect(await store.load()).toHaveLength(0);
    expect(await store.loadRunningRuns()).toHaveLength(0);
    expect(await store.loadRuns(sid('sch-1'))).toHaveLength(0);
  });
});
