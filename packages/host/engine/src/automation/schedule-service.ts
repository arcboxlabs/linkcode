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
import { Cause, Effect, Fiber, Semaphore } from 'effect';
import { nullthrow } from 'foxts/guard';
import { OperationError, RequestError } from '../failure';
import { automationFailureMessage } from './failure';
import { ScheduleCadenceCalculator } from './schedule-cadence';
import { ScheduleReporter } from './schedule-reporter';
import { ScheduleRunExecutor, ScheduleTargetGoneError } from './schedule-run-executor';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

export { ScheduleTargetGoneError } from './schedule-run-executor';

const RUNS_KEPT_PER_SCHEDULE = 100;

type RunTask = (effect: Effect.Effect<void>) => Fiber.Fiber<void>;

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
  /** Serializes persisted state transitions so request and cadence fibers cannot overwrite each other. */
  private readonly mutations = Semaphore.makeUnsafe(1);
  /** Single-flight guard: a schedule with a run in flight is skipped by the tick. */
  private readonly activeRuns = new Set<ScheduleId>();
  /** Schedule work runs in Engine's root FiberSet; local handles provide targeted draining. */
  private readonly inFlight = new Set<Fiber.Fiber<void>>();
  private readonly now: () => number;
  private readonly cadence: ScheduleCadenceCalculator;
  private readonly reporter: ScheduleReporter;
  private readonly runExecutor: ScheduleRunExecutor;
  private readonly tickMs: number;
  private readonly defaultMisfirePolicy: ScheduleMisfirePolicy;
  private timer: ReturnType<typeof setInterval> | undefined;
  private runTask: RunTask | undefined;
  private tickActive = false;
  private acceptingRuns = true;
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

  bindRuntime(runTask: RunTask): void {
    this.runTask = runTask;
  }

  async start(): Promise<void> {
    for (const schedule of await this.store.load()) {
      this.schedules.set(schedule.scheduleId, schedule);
    }
    await this.recover();
    if (this.timer) return;
    const timer = setInterval(() => {
      if (this.tickActive) return;
      this.tickActive = true;
      this.track(
        fromPromise(() => this.tickOnce()).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              this.tickActive = false;
            }),
          ),
        ),
      );
    }, this.tickMs);
    timer.unref();
    this.timer = timer;
  }

  shutdown(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.acceptingRuns = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }).pipe(Effect.andThen(this.settleAll()));
  }

  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  /** Resolves once no run is in flight. Test-only seam — the tick never awaits runs. */
  settleAll(): Effect.Effect<void> {
    return Effect.asVoid(Effect.all([...this.inFlight].map((fiber) => Fiber.await(fiber))));
  }

  create(spec: ScheduleSpec): Effect.Effect<Schedule, RequestError | OperationError> {
    return this.serialized(() =>
      cadenceEffect(() => {
        this.cadence.validate(spec.cadence);
        const now = this.now();
        return {
          scheduleId: this.mintScheduleId(),
          spec,
          status: 'active',
          nextRunAt: this.cadence.next(spec.cadence, now),
          runCount: 0,
          createdAt: now,
          updatedAt: now,
        } satisfies Schedule;
      }).pipe(
        Effect.flatMap((schedule) =>
          storeEffect('schedules.save', 'Failed to create schedule', () =>
            this.store.save(schedule),
          ).pipe(Effect.as(schedule)),
        ),
        Effect.tap((schedule) =>
          Effect.sync(() => {
            this.schedules.set(schedule.scheduleId, schedule);
            this.reporter.changed(schedule);
          }),
        ),
      ),
    );
  }

  update(
    scheduleId: ScheduleId,
    patch: ScheduleUpdate,
  ): Effect.Effect<Schedule, RequestError | OperationError> {
    return this.serialized(() =>
      this.find(scheduleId).pipe(
        Effect.flatMap((current) =>
          cadenceEffect(() => {
            if (patch.cadence !== undefined) this.cadence.validate(patch.cadence);
            return {
              ...current,
              spec: {
                ...current.spec,
                ...(patch.name !== undefined && { name: patch.name }),
                ...(patch.prompt !== undefined && { prompt: patch.prompt }),
                ...(patch.cadence !== undefined && { cadence: patch.cadence }),
                ...(patch.maxRuns !== undefined && { maxRuns: patch.maxRuns }),
                ...(patch.expiresAt !== undefined && { expiresAt: patch.expiresAt }),
                ...(patch.misfirePolicy !== undefined && { misfirePolicy: patch.misfirePolicy }),
              },
              ...(current.status === 'active' &&
                patch.cadence !== undefined && {
                  nextRunAt: this.cadence.next(patch.cadence, this.now()),
                }),
              updatedAt: this.now(),
            };
          }),
        ),
        Effect.flatMap((schedule) =>
          storeEffect('schedules.save', 'Failed to update schedule', () =>
            this.store.save(schedule),
          ).pipe(Effect.as(schedule)),
        ),
        Effect.tap((schedule) =>
          Effect.sync(() => {
            this.schedules.set(scheduleId, schedule);
            this.reporter.changed(schedule);
          }),
        ),
      ),
    );
  }

  delete(scheduleId: ScheduleId): Effect.Effect<void, RequestError | OperationError> {
    return this.serialized(() =>
      this.find(scheduleId).pipe(
        Effect.andThen(
          storeEffect('schedules.delete', 'Failed to delete schedule', () =>
            this.store.delete(scheduleId),
          ),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            this.schedules.delete(scheduleId);
            this.reporter.removed(scheduleId);
          }),
        ),
      ),
    );
  }

  pause(scheduleId: ScheduleId): Effect.Effect<void, RequestError | OperationError> {
    return this.changeStatus(scheduleId, 'paused');
  }

  resume(scheduleId: ScheduleId): Effect.Effect<void, RequestError | OperationError> {
    return this.changeStatus(scheduleId, 'active');
  }

  /** Fire one manual run now without touching the cadence or `nextRunAt`. */
  runOnce(scheduleId: ScheduleId): Effect.Effect<void, RequestError> {
    if (!this.acceptingRuns) {
      return Effect.fail(conflict('Schedule service is shutting down'));
    }
    return this.find(scheduleId).pipe(
      Effect.flatMap((schedule) => {
        if (schedule.status === 'completed') {
          return Effect.fail(conflict('Schedule is already completed'));
        }
        if (this.activeRuns.has(scheduleId)) {
          return Effect.fail(conflict('Schedule run already in progress'));
        }
        return Effect.sync(() => this.startRun(schedule, 'manual'));
      }),
    );
  }

  listRuns(
    scheduleId: ScheduleId,
    limit?: number,
  ): Effect.Effect<ScheduleRun[], RequestError | OperationError> {
    return Effect.suspend(() =>
      this.find(scheduleId).pipe(
        Effect.andThen(
          storeEffect('schedule-runs.load', 'Failed to load schedule runs', () =>
            this.store.loadRuns(scheduleId, limit),
          ),
        ),
      ),
    );
  }

  private changeStatus(
    scheduleId: ScheduleId,
    status: 'active' | 'paused',
  ): Effect.Effect<void, RequestError | OperationError> {
    return this.serialized(() =>
      this.find(scheduleId).pipe(
        Effect.flatMap((current) => {
          if (current.status === 'completed') {
            return Effect.fail(conflict('Schedule is already completed'));
          }
          if (current.status === status) return Effect.void;
          return cadenceEffect(() => ({
            ...current,
            status,
            nextRunAt:
              status === 'active' ? this.cadence.next(current.spec.cadence, this.now()) : undefined,
            updatedAt: this.now(),
          })).pipe(
            Effect.flatMap((schedule) =>
              storeEffect(
                'schedules.save',
                status === 'active' ? 'Failed to resume schedule' : 'Failed to pause schedule',
                () => this.store.save(schedule),
              ).pipe(Effect.as(schedule)),
            ),
            Effect.tap((schedule) =>
              Effect.sync(() => {
                this.schedules.set(scheduleId, schedule);
                this.reporter.changed(schedule);
              }),
            ),
            Effect.asVoid,
          );
        }),
      ),
    );
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- shutdown can close admission while the awaited store operations are pending.
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
      this.startRun(schedule, isMiss ? 'catch-up' : 'cadence');
    }
  }

  private startRun(schedule: Schedule, trigger: ScheduleRunTrigger): void {
    this.activeRuns.add(schedule.scheduleId);
    this.track(this.launchRun(schedule, trigger));
  }

  /** Track Engine-owned schedule work for targeted shutdown without creating another Runtime. */
  private track(effect: Effect.Effect<void, unknown>): void {
    const run = nullthrow(this.runTask, 'Schedule runtime has not started');
    const fiber = run(
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError('Schedule task failed', Cause.squash(cause)),
        ),
      ),
    );
    this.inFlight.add(fiber);
    fiber.addObserver(() => this.inFlight.delete(fiber));
  }

  private launchRun(schedule: Schedule, trigger: ScheduleRunTrigger): Effect.Effect<void, unknown> {
    const scheduleId = schedule.scheduleId;
    const run: ScheduleRun = {
      runId: this.mintRunId(),
      scheduleId,
      status: 'running',
      trigger,
      startedAt: this.now(),
    };
    return fromPromise(() => this.saveRun(run)).pipe(
      Effect.andThen(
        this.runExecutor.execute(schedule, run).pipe(
          Effect.matchEffect({
            onFailure: (error) => {
              run.status = 'failed';
              // Bare message (no `Error:` prefix) — this string is shown in the run history.
              run.error = automationFailureMessage(error);
              const diagnostic = Effect.logError(
                'Schedule run failed',
                {
                  scheduleId,
                  runId: run.runId,
                  operation: 'automation.schedule.run',
                },
                error,
              );
              if (!(error instanceof ScheduleTargetGoneError)) return diagnostic;
              const current = this.schedules.get(scheduleId);
              const completion = current
                ? fromPromise(() => this.complete(current, 'targetGone'))
                : Effect.void;
              return diagnostic.pipe(Effect.andThen(completion));
            },
            onSuccess: (outcome) =>
              Effect.sync(() => {
                run.status = 'succeeded';
                run.sessionId = outcome.sessionId;
                run.summary = outcome.summary;
              }),
          }),
        ),
      ),
      Effect.andThen(
        Effect.suspend(() => {
          run.endedAt = this.now();
          return fromPromise(() => this.saveRun(run));
        }),
      ),
      Effect.andThen(fromPromise(() => this.store.pruneRuns(scheduleId, RUNS_KEPT_PER_SCHEDULE))),
      Effect.andThen(
        Effect.suspend(() =>
          fromPromise(() =>
            this.settleScheduleAfterRun(scheduleId, trigger, nullthrow(run.endedAt)),
          ),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          this.activeRuns.delete(scheduleId);
        }),
      ),
      Effect.asVoid,
    );
  }

  /** Bookkeeping once a run settles: count scheduled runs toward maxRuns; record lastRunAt. */
  private async settleScheduleAfterRun(
    scheduleId: ScheduleId,
    trigger: ScheduleRunTrigger,
    endedAt: number,
  ): Promise<void> {
    const schedule = this.schedules.get(scheduleId);
    // A schedule completed mid-run (targetGone) is terminal; leave it alone.
    if (schedule?.status !== 'active') return;
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

  private find(scheduleId: ScheduleId): Effect.Effect<Schedule, RequestError> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      return Effect.fail(new RequestError({ code: 'not_found', message: 'Schedule not found' }));
    }
    return Effect.succeed(schedule);
  }

  private async saveRun(run: ScheduleRun): Promise<void> {
    await this.store.saveRun(run);
    this.reporter.runChanged(run);
  }

  private serialized<A, E>(effect: () => Effect.Effect<A, E>): Effect.Effect<A, E> {
    return this.mutations.withPermit(Effect.suspend(effect));
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

function fromPromise<A>(run: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause });
}

function cadenceEffect<A>(run: () => A): Effect.Effect<A, RequestError> {
  return Effect.try({
    try: run,
    catch: () => new RequestError({ code: 'invalid_request', message: 'Invalid schedule cadence' }),
  });
}

function storeEffect<A>(
  operation: string,
  publicMessage: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, OperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new OperationError({ subsystem: 'store', operation, publicMessage, cause }),
  });
}

function conflict(message: string): RequestError {
  return new RequestError({ code: 'conflict', message });
}
