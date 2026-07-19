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
import { Effect } from 'effect';
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

class BlockingSessionDriver extends FakeSessionDriver {
  readonly promptStarted: Promise<void>;
  readonly promptRelease: Promise<TurnResult>;
  releasePrompt: (result: TurnResult) => void = noop;
  private markPromptStarted: () => void = noop;

  constructor() {
    super();
    this.promptStarted = new Promise((resolve) => {
      this.markPromptStarted = resolve;
    });
    this.promptRelease = new Promise((resolve) => {
      this.releasePrompt = resolve;
    });
  }

  override prompt(sessionId: SessionId): Promise<TurnResult> {
    this.calls.push({ op: 'prompt', sessionId });
    this.markPromptStarted();
    return this.promptRelease;
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

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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
    service.bindRuntime(Effect.runFork);
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

  it('persists and broadcasts an updated misfire policy', async () => {
    const { service, store, sent } = makeService();
    const schedule = await service.create({ ...INTERVAL_SPEC, misfirePolicy: 'skip' });

    const updated = await service.update(schedule.scheduleId, { misfirePolicy: 'catch-up' });

    expect(updated.spec.misfirePolicy).toBe('catch-up');
    expect((await store.load())[0]?.spec.misfirePolicy).toBe('catch-up');
    expect(schedulesIn(sent).at(-1)?.spec.misfirePolicy).toBe('catch-up');
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
    await Effect.runPromise(service.settleAll());

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
    await Effect.runPromise(service.settleAll());

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
    await Effect.runPromise(service.settleAll());

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
    await Effect.runPromise(service.settleAll());

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
    await Effect.runPromise(service.settleAll());
    clock += 60000;
    await service.tickOnce();
    await Effect.runPromise(service.settleAll());

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
    await Effect.runPromise(skip.service.settleAll());
    expect(runsIn(skip.sent).at(-1)?.status).toBe('skipped');
    expect(skipDriver.calls.some((c) => c.op === 'prompt')).toBe(false);

    // Miss the slot by 2h (< 12h grace) → catch-up run.
    const catchDriver = new FakeSessionDriver();
    const c = makeService(catchDriver);
    await c.service.create(dailySpec);
    clock += DAILY + 2 * 60 * 60 * 1000;
    await c.service.tickOnce();
    await Effect.runPromise(c.service.settleAll());
    const run = runsIn(c.sent).at(-1);
    expect(run?.status).toBe('succeeded');
    expect(run?.trigger).toBe('catch-up');
  });

  it("a schedule's skip misfire policy fast-forwards a missed window without running", async () => {
    const driver = new FakeSessionDriver();
    const { service, sent } = makeService(driver);
    // A mid-slot miss within grace: the default policy would catch up; `skip` suppresses the run.
    await service.create({ ...INTERVAL_SPEC, misfirePolicy: 'skip' });
    clock += 150_000; // 2.5 intervals late → 30s past the latest slot
    await service.tickOnce();
    await Effect.runPromise(service.settleAll());

    expect(driver.calls.some((c) => c.op === 'prompt')).toBe(false);
    expect(runsIn(sent)).toHaveLength(0);
    // nextRunAt still advanced past now.
    expect(schedulesIn(sent).at(-1)?.nextRunAt).toBeGreaterThan(clock);
  });

  it('honors a global default misfire policy when the schedule has none', async () => {
    const driver = new FakeSessionDriver();
    const { transport, sent } = recordingTransport();
    const service = new ScheduleService(transport, new InMemoryScheduleStore(), driver, {
      now,
      tickMs: 1000,
      defaultMisfirePolicy: 'skip',
    });
    service.bindRuntime(Effect.runFork);
    await service.create(INTERVAL_SPEC);
    clock += 150_000;
    await service.tickOnce();
    await Effect.runPromise(service.settleAll());

    expect(driver.calls.some((c) => c.op === 'prompt')).toBe(false);
    expect(runsIn(sent)).toHaveLength(0);
  });

  it('shutdown waits for an accepted run to unwind', async () => {
    const driver = new BlockingSessionDriver();
    const { service } = makeService(driver);
    const schedule = await service.create(INTERVAL_SPEC);
    service.runOnce(schedule.scheduleId);
    await driver.promptStarted;

    let shutdownSettled = false;
    const shutdown = Effect.runPromise(service.shutdown()).then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(shutdownSettled).toBe(false);

    driver.releasePrompt({ stopReason: 'end_turn', text: 'done' });
    await shutdown;
    expect(driver.calls.map((call) => call.op)).toEqual([
      'create',
      'makeUnattended',
      'prompt',
      'stop',
    ]);
  });

  it('shutdown rejects new manual and cadence runs', async () => {
    const driver = new BlockingSessionDriver();
    const { service } = makeService(driver);
    const accepted = await service.create(INTERVAL_SPEC);
    const manual = await service.create(INTERVAL_SPEC);
    await service.create(INTERVAL_SPEC);
    service.runOnce(accepted.scheduleId);
    await driver.promptStarted;

    const shutdown = Effect.runPromise(service.shutdown());
    try {
      service.runOnce(manual.scheduleId);
    } catch {
      // Rejecting the request synchronously is an acceptable Promise-facing boundary behavior.
    }
    clock += 60000;
    await service.tickOnce();
    await flushAsyncWork();

    expect(driver.calls.filter((call) => call.op === 'prompt')).toHaveLength(1);

    driver.releasePrompt({ stopReason: 'end_turn', text: 'done' });
    await shutdown;
  });

  it('repeated shutdown calls await the same unwind', async () => {
    const driver = new BlockingSessionDriver();
    const { service } = makeService(driver);
    const schedule = await service.create(INTERVAL_SPEC);
    service.runOnce(schedule.scheduleId);
    await driver.promptStarted;

    let firstSettled = false;
    let secondSettled = false;
    const first = Effect.runPromise(service.shutdown()).then(() => {
      firstSettled = true;
    });
    const second = Effect.runPromise(service.shutdown()).then(() => {
      secondSettled = true;
    });
    await Promise.resolve();

    expect({ firstSettled, secondSettled }).toEqual({
      firstSettled: false,
      secondSettled: false,
    });

    driver.releasePrompt({ stopReason: 'end_turn', text: 'done' });
    await Promise.all([first, second]);
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
    await Effect.runPromise(second.service.shutdown());
  });
});
