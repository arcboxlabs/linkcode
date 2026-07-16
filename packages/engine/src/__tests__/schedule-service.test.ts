import type {
  AgentKind,
  Schedule,
  ScheduleSpec,
  SessionAutomation,
  SessionId,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { beforeEach, describe, expect, it } from 'vitest';
import { ScheduleService } from '../automation/schedule-service';
import { InMemoryScheduleStore } from '../automation/schedule-store';
import type { SessionDriver, TurnResult } from '../automation/session-driver';

function recordingTransport(): { transport: Transport; sent: WirePayload[] } {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      // Clone so later in-place mutation of the schedule/run objects can't rewrite history.
      sent.push(structuredClone(msg.payload));
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { transport, sent };
}

interface DriverCall {
  op: 'create' | 'prompt' | 'stop' | 'ensureLive' | 'makeUnattended';
  sessionId: SessionId;
}

/** Scriptable driver: records calls, mints deterministic session ids, and returns/throws per config. */
class FakeSessionDriver implements SessionDriver {
  readonly calls: DriverCall[] = [];
  readonly records = new Set<SessionId>();
  readonly busy = new Set<SessionId>();
  promptResult: TurnResult = { stopReason: 'end_turn', text: 'done' };
  lastAutomation: SessionAutomation | undefined;
  private created = 0;

  createSession(opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    title?: string;
    automation: SessionAutomation;
  }): Promise<SessionId> {
    this.created += 1;
    const sessionId = `auto-sess-${this.created}` as SessionId;
    this.records.add(sessionId);
    this.lastAutomation = opts.automation;
    this.calls.push({ op: 'create', sessionId });
    return Promise.resolve(sessionId);
  }

  hasRecord(sessionId: SessionId): boolean {
    return this.records.has(sessionId);
  }

  isBusy(sessionId: SessionId): boolean {
    return this.busy.has(sessionId);
  }

  ensureLive(sessionId: SessionId): Promise<void> {
    this.calls.push({ op: 'ensureLive', sessionId });
    return Promise.resolve();
  }

  makeUnattended(sessionId: SessionId): Promise<void> {
    this.calls.push({ op: 'makeUnattended', sessionId });
    return Promise.resolve();
  }

  prompt(sessionId: SessionId): Promise<TurnResult> {
    this.calls.push({ op: 'prompt', sessionId });
    return Promise.resolve(this.promptResult);
  }

  stopSession(sessionId: SessionId): Promise<void> {
    this.calls.push({ op: 'stop', sessionId });
    this.records.delete(sessionId);
    return Promise.resolve();
  }
}

const INTERVAL_SPEC: ScheduleSpec = {
  prompt: 'do the thing',
  cadence: { type: 'interval', everyMs: 60000 },
  target: { type: 'new-session', config: { kind: 'claude-code', cwd: '/repo' } },
};

function schedulesIn(sent: WirePayload[]): Schedule[] {
  return sent.flatMap((p) => (p.kind === 'schedule.changed' ? [p.schedule] : []));
}
function runsIn(sent: WirePayload[]) {
  return sent.flatMap((p) => (p.kind === 'schedule.run' ? [p.run] : []));
}

describe('ScheduleService', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000_000;
  });

  function makeService(driver = new FakeSessionDriver(), store = new InMemoryScheduleStore()) {
    const { transport, sent } = recordingTransport();
    const service = new ScheduleService(transport, store, driver, { now, tickMs: 1000 });
    return { service, driver, store, sent };
  }

  it('arms an interval schedule one period out and broadcasts it', async () => {
    const { service, sent } = makeService();
    const schedule = await service.create(INTERVAL_SPEC);
    expect(schedule.status).toBe('active');
    expect(schedule.nextRunAt).toBe(clock + 60000);
    expect(schedulesIn(sent).at(-1)?.scheduleId).toBe(schedule.scheduleId);
  });

  it('validates a cron expression on create', async () => {
    const { service } = makeService();
    await expect(
      service.create({ ...INTERVAL_SPEC, cadence: { type: 'cron', expression: 'nope' } }),
    ).rejects.toThrow();
  });

  it('computes the next cron run in the given timezone', async () => {
    const { service } = makeService();
    clock = Date.parse('2026-07-16T00:00:00Z');
    const schedule = await service.create({
      ...INTERVAL_SPEC,
      cadence: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
    });
    // 09:00 Shanghai == 01:00 UTC the same day.
    expect(schedule.nextRunAt).toBe(Date.parse('2026-07-16T01:00:00Z'));
  });

  it('runs a due new-session schedule: create → unattended → prompt → stop', async () => {
    const { service, driver, sent } = makeService();
    const schedule = await service.create(INTERVAL_SPEC);
    clock += 60000;
    await service.tickOnce();
    await service.settleAll();

    expect(driver.calls.map((c) => c.op)).toEqual(['create', 'makeUnattended', 'prompt', 'stop']);
    expect(driver.lastAutomation).toEqual({ kind: 'schedule', id: schedule.scheduleId });
    const run = runsIn(sent).at(-1);
    expect(run?.status).toBe('succeeded');
    expect(run?.trigger).toBe('cadence');
    expect(run?.summary).toBe('done');
    expect(run?.sessionId).toBe('auto-sess-1');
    // nextRunAt advanced past now; runCount incremented.
    const latest = schedulesIn(sent).at(-1);
    expect(latest?.runCount).toBe(1);
    expect(latest?.nextRunAt).toBe(clock + 60000);
  });

  it('fails a run against a busy existing session without touching it', async () => {
    const driver = new FakeSessionDriver();
    driver.records.add('user-sess' as SessionId);
    driver.busy.add('user-sess' as SessionId);
    const { service, sent } = makeService(driver);
    await service.create({
      ...INTERVAL_SPEC,
      target: { type: 'session', sessionId: 'user-sess' as SessionId },
    });
    clock += 60000;
    await service.tickOnce();
    await service.settleAll();

    const run = runsIn(sent).at(-1);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('session busy');
    expect(driver.calls.some((c) => c.op === 'prompt')).toBe(false);
  });

  it('completes a schedule when its target session is gone', async () => {
    const { service, sent } = makeService();
    await service.create({
      ...INTERVAL_SPEC,
      target: { type: 'session', sessionId: 'ghost' as SessionId },
    });
    clock += 60000;
    await service.tickOnce();
    await service.settleAll();

    const run = runsIn(sent).at(-1);
    expect(run?.status).toBe('failed');
    const latest = schedulesIn(sent).at(-1);
    expect(latest?.status).toBe('completed');
    expect(latest?.completedReason).toBe('targetGone');
  });

  it('run-once fires without advancing cadence or run count', async () => {
    const { service, driver, sent } = makeService();
    const schedule = await service.create(INTERVAL_SPEC);
    const armedAt = schedule.nextRunAt;
    service.runOnce(schedule.scheduleId);
    await service.settleAll();

    expect(driver.calls.some((c) => c.op === 'prompt')).toBe(true);
    const run = runsIn(sent).at(-1);
    expect(run?.trigger).toBe('manual');
    const latest = schedulesIn(sent).at(-1);
    expect(latest?.runCount).toBe(0);
    expect(latest?.nextRunAt).toBe(armedAt);
  });

  it('completes after maxRuns cadence runs', async () => {
    const { service, sent } = makeService();
    await service.create({ ...INTERVAL_SPEC, maxRuns: 2 });
    clock += 60000;
    await service.tickOnce();
    await service.settleAll();
    clock += 60000;
    await service.tickOnce();
    await service.settleAll();

    const latest = schedulesIn(sent).at(-1);
    expect(latest?.status).toBe('completed');
    expect(latest?.completedReason).toBe('maxRuns');
    expect(latest?.runCount).toBe(2);
  });

  it('completes an expired schedule instead of running it', async () => {
    const { service, driver, sent } = makeService();
    await service.create({ ...INTERVAL_SPEC, expiresAt: clock + 30000 });
    clock += 60000;
    await service.tickOnce();

    expect(driver.calls.some((c) => c.op === 'prompt')).toBe(false);
    expect(schedulesIn(sent).at(-1)?.completedReason).toBe('expired');
  });

  it('replays a missed occurrence within grace as a catch-up, and skips beyond grace', async () => {
    // A daily interval's grace is capped at 12h. The due slot sits at create + 24h.
    const DAILY = 24 * 60 * 60 * 1000;
    const dailySpec: ScheduleSpec = {
      ...INTERVAL_SPEC,
      cadence: { type: 'interval', everyMs: DAILY },
    };

    // Miss the slot by 20h (> 12h grace) → skipped, no run.
    const skipDriver = new FakeSessionDriver();
    const skip = makeService(skipDriver);
    await skip.service.create(dailySpec);
    clock += DAILY + 20 * 60 * 60 * 1000;
    await skip.service.tickOnce();
    await skip.service.settleAll();
    expect(runsIn(skip.sent).at(-1)?.status).toBe('skipped');
    expect(skipDriver.calls.some((c) => c.op === 'prompt')).toBe(false);

    // Miss the slot by 2h (< 12h grace) → catch-up run.
    const catchDriver = new FakeSessionDriver();
    const c = makeService(catchDriver);
    await c.service.create(dailySpec);
    clock += DAILY + 2 * 60 * 60 * 1000;
    await c.service.tickOnce();
    await c.service.settleAll();
    const run = runsIn(c.sent).at(-1);
    expect(run?.status).toBe('succeeded');
    expect(run?.trigger).toBe('catch-up');
  });

  it('recovers interrupted runs and orphaned targets on restart', async () => {
    const store = new InMemoryScheduleStore();
    // First service: a session-target schedule whose target exists.
    const driver1 = new FakeSessionDriver();
    driver1.records.add('user-sess' as SessionId);
    const first = makeService(driver1, store);
    const schedule = await first.service.create({
      ...INTERVAL_SPEC,
      target: { type: 'session', sessionId: 'user-sess' as SessionId },
    });
    // Simulate a run left mid-flight when the daemon died.
    await store.saveRun({
      runId: 'orphan-run' as never,
      scheduleId: schedule.scheduleId,
      status: 'running',
      trigger: 'cadence',
      startedAt: clock,
    });

    // Second service over the same store, with the target session now absent.
    const driver2 = new FakeSessionDriver();
    const second = makeService(driver2, store);
    await second.service.start();

    const failed = runsIn(second.sent).find((r) => r.runId === 'orphan-run');
    expect(failed?.status).toBe('failed');
    expect(schedulesIn(second.sent).at(-1)?.completedReason).toBe('targetGone');
    second.service.shutdown();
  });
});
