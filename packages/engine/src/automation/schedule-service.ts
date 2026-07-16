import type {
  Schedule,
  ScheduleCadence,
  ScheduleId,
  ScheduleRun,
  ScheduleRunId,
  ScheduleRunTrigger,
  ScheduleSpec,
  ScheduleUpdate,
  SessionId,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Cron } from 'croner';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

/** A run whose target no longer exists: the schedule can never fire again, so it is completed. */
export class ScheduleTargetGoneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScheduleTargetGoneError';
  }
}

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const RUNS_KEPT_PER_SCHEDULE = 100;
const SUMMARY_MAX_CHARS = 2000;

export interface ScheduleServiceOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Tick cadence; also the on-time-vs-catch-up threshold reference. */
  tickMs?: number;
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
  /** In-flight run promises, kept only so {@link settleAll} can await them in tests. */
  private readonly inFlight = new Map<ScheduleId, Promise<void>>();
  private readonly now: () => number;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private seq = 0;

  constructor(
    private readonly transport: Transport,
    private readonly store: ScheduleStore,
    private readonly driver: SessionDriver,
    options: ScheduleServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.tickMs = options.tickMs ?? 1000;
  }

  async start(): Promise<void> {
    for (const schedule of await this.store.load()) {
      this.schedules.set(schedule.scheduleId, schedule);
    }
    await this.recover();
    if (this.timer) return;
    const timer = setInterval(() => {
      void this.tickOnce().catch((err: unknown) => {
        console.error('Schedule tick failed:', err);
      });
    }, this.tickMs);
    timer.unref();
    this.timer = timer;
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  /** Resolves once no run is in flight. Test-only seam — the tick never awaits runs. */
  async settleAll(): Promise<void> {
    await Promise.all(this.inFlight.values());
  }

  async create(spec: ScheduleSpec): Promise<Schedule> {
    this.validateCadence(spec.cadence);
    const now = this.now();
    const schedule: Schedule = {
      scheduleId: this.mintScheduleId(),
      spec,
      status: 'active',
      nextRunAt: this.nextOccurrence(spec.cadence, now),
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(schedule.scheduleId, schedule);
    await this.store.save(schedule);
    this.broadcastSchedule(schedule);
    return schedule;
  }

  async update(scheduleId: ScheduleId, patch: ScheduleUpdate): Promise<Schedule> {
    const schedule = this.require(scheduleId);
    if (patch.cadence !== undefined) this.validateCadence(patch.cadence);
    schedule.spec = {
      ...schedule.spec,
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.prompt !== undefined && { prompt: patch.prompt }),
      ...(patch.cadence !== undefined && { cadence: patch.cadence }),
      ...(patch.maxRuns !== undefined && { maxRuns: patch.maxRuns }),
      ...(patch.expiresAt !== undefined && { expiresAt: patch.expiresAt }),
    };
    // A cadence change re-bases the next fire from now; other edits leave the schedule armed as-is.
    if (schedule.status === 'active' && patch.cadence !== undefined) {
      schedule.nextRunAt = this.nextOccurrence(schedule.spec.cadence, this.now());
    }
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.broadcastSchedule(schedule);
    return schedule;
  }

  async delete(scheduleId: ScheduleId): Promise<void> {
    this.schedules.delete(scheduleId);
    await this.store.delete(scheduleId);
    this.broadcastRemoved(scheduleId);
  }

  async pause(scheduleId: ScheduleId): Promise<void> {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'completed') throw new Error('Schedule is already completed');
    if (schedule.status === 'paused') return;
    schedule.status = 'paused';
    schedule.nextRunAt = undefined;
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.broadcastSchedule(schedule);
  }

  async resume(scheduleId: ScheduleId): Promise<void> {
    const schedule = this.require(scheduleId);
    if (schedule.status === 'completed') throw new Error('Schedule is already completed');
    if (schedule.status === 'active') return;
    schedule.status = 'active';
    schedule.nextRunAt = this.nextOccurrence(schedule.spec.cadence, this.now());
    schedule.updatedAt = this.now();
    await this.store.save(schedule);
    this.broadcastSchedule(schedule);
  }

  /** Fire one manual run now without touching the cadence or `nextRunAt`. */
  runOnce(scheduleId: ScheduleId): void {
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
    const now = this.now();
    for (const schedule of this.schedules.values()) {
      if (schedule.status !== 'active' || schedule.nextRunAt === undefined) continue;
      if (this.activeRuns.has(schedule.scheduleId)) continue;
      if (schedule.nextRunAt > now) continue;
      await this.fireDue(schedule, now);
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
    const latestMissed = this.latestOccurrenceAtOrBefore(cadence, schedule.nextRunAt ?? now, now);
    const missedBy = now - latestMissed;
    schedule.nextRunAt = this.nextOccurrence(cadence, latestMissed);
    schedule.updatedAt = now;
    await this.store.save(schedule);
    this.broadcastSchedule(schedule);

    if (missedBy > this.graceMs(cadence)) {
      await this.recordSkipped(schedule, latestMissed, now);
      return;
    }
    const trigger: ScheduleRunTrigger =
      missedBy > this.catchUpThresholdMs() ? 'catch-up' : 'cadence';
    this.track(schedule.scheduleId, this.launchRun(schedule, trigger));
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
      const outcome = await this.executeRun(schedule, run);
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
    this.broadcastSchedule(schedule);
  }

  private async executeRun(
    schedule: Schedule,
    run: ScheduleRun,
  ): Promise<{ sessionId: SessionId; summary?: string }> {
    const target = schedule.spec.target;
    if (target.type === 'session') {
      if (!this.driver.hasRecord(target.sessionId)) {
        throw new ScheduleTargetGoneError(`target session no longer exists: ${target.sessionId}`);
      }
      if (this.driver.isBusy(target.sessionId)) throw new Error('session busy');
      await this.driver.ensureLive(target.sessionId);
      await this.linkRunSession(run, target.sessionId);
      const result = await this.driver.prompt(target.sessionId, schedule.spec.prompt);
      return { sessionId: target.sessionId, summary: this.summarize(result.text) };
    }

    const sessionId = await this.driver.createSession({
      kind: target.config.kind,
      cwd: target.config.cwd,
      model: target.config.model,
      title: schedule.spec.name ?? 'Scheduled run',
      automation: { kind: 'schedule', id: schedule.scheduleId },
    });
    await this.linkRunSession(run, sessionId);
    try {
      await this.driver.makeUnattended(sessionId);
      const result = await this.driver.prompt(sessionId, schedule.spec.prompt);
      return { sessionId, summary: this.summarize(result.text) };
    } finally {
      // The record is kept (hidden from Threads); the run's summary is the durable output.
      await this.driver.stopSession(sessionId);
    }
  }

  private async linkRunSession(run: ScheduleRun, sessionId: SessionId): Promise<void> {
    run.sessionId = sessionId;
    await this.saveRun(run);
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
    this.broadcastSchedule(schedule);
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

  // ── Cadence math ──────────────────────────────────────────────────────────

  private buildCron(cadence: Extract<ScheduleCadence, { type: 'cron' }>): Cron {
    return new Cron(cadence.expression, cadence.timezone ? { timezone: cadence.timezone } : {});
  }

  /** Throws (surfaced as `request.failed`) on an invalid cron expression or time zone. */
  private validateCadence(cadence: ScheduleCadence): void {
    if (cadence.type === 'cron') this.buildCron(cadence);
  }

  /** The first occurrence strictly after `from`. */
  private nextOccurrence(cadence: ScheduleCadence, from: number): number {
    if (cadence.type === 'interval') return from + cadence.everyMs;
    const next = this.buildCron(cadence).nextRun(new Date(from));
    // A cron with no future occurrence (never for a 5-field pattern) parks a period ahead.
    return next ? next.getTime() : from + TWELVE_HOURS_MS;
  }

  /** The last occurrence at or before `now`, walking forward from the earliest missed `from`. */
  private latestOccurrenceAtOrBefore(cadence: ScheduleCadence, from: number, now: number): number {
    if (cadence.type === 'interval') {
      if (now <= from) return from;
      const steps = Math.floor((now - from) / cadence.everyMs);
      return from + steps * cadence.everyMs;
    }
    let current = from;
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const next = this.nextOccurrence(cadence, current);
      if (next > now) break;
      current = next;
    }
    return current;
  }

  private graceMs(cadence: ScheduleCadence): number {
    if (cadence.type === 'interval') return Math.min(cadence.everyMs, TWELVE_HOURS_MS);
    // The current period is the gap between the next two occurrences.
    const a = this.nextOccurrence(cadence, this.now());
    const b = this.nextOccurrence(cadence, a);
    return Math.min(b - a, TWELVE_HOURS_MS);
  }

  private catchUpThresholdMs(): number {
    return Math.max(this.tickMs * 2, 5000);
  }

  private reachedMaxRuns(schedule: Schedule): boolean {
    return schedule.spec.maxRuns !== undefined && schedule.runCount >= schedule.spec.maxRuns;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private summarize(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return trimmed.length > SUMMARY_MAX_CHARS ? trimmed.slice(0, SUMMARY_MAX_CHARS) : trimmed;
  }

  private require(scheduleId: ScheduleId): Schedule {
    return nullthrow(this.schedules.get(scheduleId), `Unknown schedule: ${scheduleId}`);
  }

  private async saveRun(run: ScheduleRun): Promise<void> {
    await this.store.saveRun(run);
    this.broadcastRun(run);
  }

  private mintScheduleId(): ScheduleId {
    this.seq += 1;
    return `sch-${this.now().toString(36)}-${this.seq.toString(36)}` as ScheduleId;
  }

  private mintRunId(): ScheduleRunId {
    this.seq += 1;
    return `srun-${this.now().toString(36)}-${this.seq.toString(36)}` as ScheduleRunId;
  }

  private broadcastSchedule(schedule: Schedule): void {
    this.transport.send(createWireMessage({ kind: 'schedule.changed', schedule }));
  }

  private broadcastRemoved(scheduleId: ScheduleId): void {
    this.transport.send(createWireMessage({ kind: 'schedule.removed', scheduleId }));
  }

  private broadcastRun(run: ScheduleRun): void {
    this.transport.send(createWireMessage({ kind: 'schedule.run', run }));
  }
}
