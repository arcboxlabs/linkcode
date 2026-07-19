import type {
  Schedule,
  ScheduleId,
  ScheduleMisfirePolicy,
  ScheduleRun,
  ScheduleRunId,
  ScheduleRunTrigger,
  ScheduleSpec,
  ScheduleUpdate,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { ScheduleCadenceCalculator } from './schedule-cadence';
import { ScheduleReporter } from './schedule-reporter';
import { ScheduleRunExecutor, ScheduleTargetGoneError } from './schedule-run-executor';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

export { ScheduleTargetGoneError } from './schedule-run-executor';

const RUNS_KEPT_PER_SCHEDULE = 100;

export interface ScheduleServiceOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Tick cadence; also the on-time-vs-catch-up threshold reference. */
  tickMs?: number;
  /** Missed-window policy for schedules that don't set their own; the daemon wires this from config. */
  defaultMisfirePolicy?: ScheduleMisfirePolicy;
}

/**
 * Owns the cron/interval schedules: a central tick resolves each schedule's `nextRunAt` and
 * dispatches a run through the {@link SessionDriver}. State is broadcast whole (`schedule.changed` /
 * `schedule.run`) so late-joining clients fold it from the `schedule.list` snapshot. The service
 * never imports the Engine — it drives sessions only through the injected driver.
 */
export class ScheduleService {
  private readonly schedules = new Map<ScheduleId, Schedule>();
  /** Single-flight guard: a schedule with a run in flight is skipped by the tick. */
  private readonly activeRuns = new Set<ScheduleId>();
  /** Accepted runs stay owned until they settle so shutdown cannot outlive their side effects. */
  private readonly inFlight = new Map<ScheduleId, Promise<void>>();
  private readonly now: () => number;
  private readonly cadence: ScheduleCadenceCalculator;
  private readonly reporter: ScheduleReporter;
  private readonly runExecutor: ScheduleRunExecutor;
  private readonly tickMs: number;
  private readonly defaultMisfirePolicy: ScheduleMisfirePolicy;
  private timer: ReturnType<typeof setInterval> | undefined;
  private tickInFlight: Promise<void> | undefined;
  private acceptingRuns = true;
  private shutdownPromise: Promise<void> | undefined;
  private seq = 0;

  constructor(
    transport: Transport,
    private readonly store: ScheduleStore,
    private readonly driver: SessionDriver,
    options: ScheduleServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.cadence = new ScheduleCadenceCalculator(this.now);
    this.reporter = new ScheduleReporter(transport);
    this.runExecutor = new ScheduleRunExecutor(driver, store, this.reporter);
    this.tickMs = options.tickMs ?? 1000;
    this.defaultMisfirePolicy = options.defaultMisfirePolicy ?? 'catch-up';
  }

  async start(): Promise<void> {
    for (const schedule of await this.store.load()) {
      this.schedules.set(schedule.scheduleId, schedule);
    }
    await this.recover();
    if (this.timer) return;
    const timer = setInterval(() => {
      if (this.tickInFlight) return;
      const tick = this.tickOnce()
        .catch((err: unknown) => {
          console.error('Schedule tick failed:', err);
        })
        .finally(() => {
          if (this.tickInFlight === tick) this.tickInFlight = undefined;
        });
      this.tickInFlight = tick;
    }, this.tickMs);
    timer.unref();
    this.timer = timer;
  }

  shutdown(): Promise<void> {
    this.acceptingRuns = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.shutdownPromise ??= this.drain();
    return this.shutdownPromise;
  }

  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  /** Resolves once no run is in flight. Test-only seam — the tick never awaits runs. */
  async settleAll(): Promise<void> {
    await Promise.all(this.inFlight.values());
  }

  async create(spec: ScheduleSpec): Promise<Schedule> {
    this.cadence.validate(spec.cadence);
    const now = this.now();
    const schedule: Schedule = {
      scheduleId: this.mintScheduleId(),
      spec,
      status: 'active',
      nextRunAt: this.cadence.next(spec.cadence, now),
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(schedule.scheduleId, schedule);
    await this.store.save(schedule);
    this.reporter.changed(schedule);
    return schedule;
  }

  async update(scheduleId: ScheduleId, patch: ScheduleUpdate): Promise<Schedule> {
    const schedule = this.require(scheduleId);
    if (patch.cadence !== undefined) this.cadence.validate(patch.cadence);
    schedule.spec = {
      ...schedule.spec,
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.prompt !== undefined && { prompt: patch.prompt }),
      ...(patch.cadence !== undefined && { cadence: patch.cadence }),
      ...(patch.maxRuns !== undefined && { maxRuns: patch.maxRuns }),
      ...(patch.expiresAt !== undefined && { expiresAt: patch.expiresAt }),
      ...(patch.misfirePolicy !== undefined && { misfirePolicy: patch.misfirePolicy }),
    };
    // A cadence change re-bases the next fire from now; other edits leave the schedule armed as-is.
    if (schedule.status === 'active' && patch.cadence !== undefined) {
      schedule.nextRunAt = this.cadence.next(schedule.spec.cadence, this.now());
    }
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.reporter.changed(schedule);
    return schedule;
  }

  async delete(scheduleId: ScheduleId): Promise<void> {
    this.schedules.delete(scheduleId);
    await this.store.delete(scheduleId);
    this.reporter.removed(scheduleId);
  }

  async pause(scheduleId: ScheduleId): Promise<void> {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'completed') throw new Error('Schedule is already completed');
    if (schedule.status === 'paused') return;
    schedule.status = 'paused';
    schedule.nextRunAt = undefined;
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.reporter.changed(schedule);
  }

  async resume(scheduleId: ScheduleId): Promise<void> {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'completed') throw new Error('Schedule is already completed');
    if (schedule.status === 'active') return;
    schedule.status = 'active';
    schedule.nextRunAt = this.cadence.next(schedule.spec.cadence, this.now());
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.reporter.changed(schedule);
  }

  /** Fire one manual run now without touching the cadence or `nextRunAt`. */
  runOnce(scheduleId: ScheduleId): void {
    if (!this.acceptingRuns) throw new Error('Schedule service is shutting down');
    const schedule = this.require(scheduleId);
    if (schedule.status === 'completed') throw new Error('Schedule is already completed');
    if (this.activeRuns.has(scheduleId)) throw new Error('Schedule run already in progress');
    this.track(scheduleId, this.launchRun(schedule, 'manual'));
  }

  listRuns(scheduleId: ScheduleId, limit?: number): Promise<ScheduleRun[]> {
    this.require(scheduleId);
    return this.store.loadRuns(scheduleId, limit);
  }

  /** One scheduler pass. Public so tests can drive it deterministically instead of the interval. */
  async tickOnce(): Promise<void> {
    if (!this.acceptingRuns) return;
    const now = this.now();
    for (const schedule of this.schedules.values()) {
      if (schedule.status !== 'active' || schedule.nextRunAt === undefined) continue;
      if (this.activeRuns.has(schedule.scheduleId)) continue;
      if (schedule.nextRunAt > now) continue;
      await this.fireDue(schedule, now);
      if (!this.acceptingRuns) return;
    }
  }

  /**
   * A due schedule: complete it if expired; otherwise advance `nextRunAt` past now (before launching,
   * so a slow run can't double-fire), then either replay the most recent missed occurrence within
   * the grace window (a catch-up) or record it skipped.
   */
  private async fireDue(schedule: Schedule, now: number): Promise<void> {
    if (schedule.spec.expiresAt !== undefined && schedule.spec.expiresAt <= now) {
      await this.complete(schedule, 'expired');
      return;
    }
    const cadence = schedule.spec.cadence;
    const latestMissed = this.cadence.latestAtOrBefore(cadence, schedule.nextRunAt ?? now, now);
    const missedBy = now - latestMissed;
    schedule.nextRunAt = this.cadence.next(cadence, latestMissed);
    schedule.updatedAt = now;
    await this.store.save(schedule);
    this.reporter.changed(schedule);

    // On-time fires (within the catch-up threshold) always run, whatever the policy.
    const isMiss = missedBy > this.catchUpThresholdMs();
    if (isMiss) {
      const policy = schedule.spec.misfirePolicy ?? this.defaultMisfirePolicy;
      // `skip` fast-forwards silently (nextRunAt already advanced); `catch-up` beyond grace records
      // a skipped run for visibility; within grace it replays the most recent missed occurrence.
      if (policy === 'skip') return;
      if (missedBy > this.cadence.graceMs(cadence)) {
        await this.recordSkipped(schedule, latestMissed, now);
        return;
      }
    }
    if (this.acceptingRuns) {
      this.track(schedule.scheduleId, this.launchRun(schedule, isMiss ? 'catch-up' : 'cadence'));
    }
  }

  /** Track an in-flight run so {@link settleAll} can await it; log and drop failures. */
  private track(scheduleId: ScheduleId, run: Promise<void>): void {
    const wrapped = run
      .catch((err: unknown) => {
        console.error('Schedule run failed:', err);
      })
      .finally(() => {
        if (this.inFlight.get(scheduleId) === wrapped) this.inFlight.delete(scheduleId);
      });
    this.inFlight.set(scheduleId, wrapped);
  }

  private async drain(): Promise<void> {
    await this.tickInFlight;
    await this.settleAll();
  }

  private async launchRun(schedule: Schedule, trigger: ScheduleRunTrigger): Promise<void> {
    const scheduleId = schedule.scheduleId;
    this.activeRuns.add(scheduleId);
    const run: ScheduleRun = {
      runId: this.mintRunId(),
      scheduleId,
      status: 'running',
      trigger,
      startedAt: this.now(),
    };
    await this.saveRun(run);
    try {
      const outcome = await this.runExecutor.execute(schedule, run);
      run.status = 'succeeded';
      run.sessionId = outcome.sessionId;
      run.summary = outcome.summary;
    } catch (err) {
      run.status = 'failed';
      // Bare message (no `Error:` prefix) — this string is shown to the user in the run history.
      run.error = extractErrorMessage(err, false) ?? 'run failed';
      if (err instanceof ScheduleTargetGoneError) await this.complete(schedule, 'targetGone');
    } finally {
      run.endedAt = this.now();
      await this.saveRun(run);
      await this.store.pruneRuns(scheduleId, RUNS_KEPT_PER_SCHEDULE);
      this.activeRuns.delete(scheduleId);
      await this.settleScheduleAfterRun(schedule, trigger, run.endedAt);
    }
  }

  /** Bookkeeping once a run settles: count scheduled runs toward maxRuns; record lastRunAt. */
  private async settleScheduleAfterRun(
    schedule: Schedule,
    trigger: ScheduleRunTrigger,
    endedAt: number,
  ): Promise<void> {
    // A schedule completed mid-run (targetGone) is terminal; leave it alone.
    if (schedule.status !== 'active') return;
    schedule.lastRunAt = endedAt;
    if (trigger !== 'manual') schedule.runCount += 1;
    if (trigger !== 'manual' && this.reachedMaxRuns(schedule)) {
      await this.complete(schedule, 'maxRuns');
      return;
    }
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.reporter.changed(schedule);
  }

  private async recordSkipped(
    schedule: Schedule,
    scheduledFor: number,
    now: number,
  ): Promise<void> {
    const run: ScheduleRun = {
      runId: this.mintRunId(),
      scheduleId: schedule.scheduleId,
      status: 'skipped',
      trigger: 'catch-up',
      error: 'missed run window elapsed beyond the grace period',
      startedAt: scheduledFor,
      endedAt: now,
    };
    await this.saveRun(run);
    await this.store.pruneRuns(schedule.scheduleId, RUNS_KEPT_PER_SCHEDULE);
  }

  private async complete(schedule: Schedule, reason: Schedule['completedReason']): Promise<void> {
    schedule.status = 'completed';
    schedule.completedReason = reason;
    schedule.nextRunAt = undefined;
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.reporter.changed(schedule);
  }

  /** Mark runs left `running` by a previous daemon as failed, then complete orphaned targets. */
  private async recover(): Promise<void> {
    for (const run of await this.store.loadRunningRuns()) {
      run.status = 'failed';
      run.error = 'daemon restarted before the run completed';
      run.endedAt = this.now();
      await this.saveRun(run);
    }
    for (const schedule of this.schedules.values()) {
      if (schedule.status !== 'active') continue;
      const target = schedule.spec.target;
      if (target.type === 'session' && !this.driver.hasRecord(target.sessionId)) {
        await this.complete(schedule, 'targetGone');
      }
    }
  }

  private catchUpThresholdMs(): number {
    return Math.max(this.tickMs * 2, 5000);
  }

  private reachedMaxRuns(schedule: Schedule): boolean {
    return schedule.spec.maxRuns !== undefined && schedule.runCount >= schedule.spec.maxRuns;
  }

  private require(scheduleId: ScheduleId): Schedule {
    return nullthrow(this.schedules.get(scheduleId), `Unknown schedule: ${scheduleId}`);
  }

  private async saveRun(run: ScheduleRun): Promise<void> {
    await this.store.saveRun(run);
    this.reporter.runChanged(run);
  }

  private mintScheduleId(): ScheduleId {
    this.seq += 1;
    return `sch-${this.now().toString(36)}-${this.seq.toString(36)}` as ScheduleId;
  }

  private mintRunId(): ScheduleRunId {
    this.seq += 1;
    return `srun-${this.now().toString(36)}-${this.seq.toString(36)}` as ScheduleRunId;
  }
}
