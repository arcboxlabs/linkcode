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
import { Cause, Effect, Schedule as EffectSchedule, Fiber, Semaphore } from 'effect';
import { nullthrow } from 'foxts/guard';
import { OperationError, RequestError } from '../failure';
import { ScheduleCadenceCalculator } from './schedule-cadence';
import { ScheduleReporter } from './schedule-reporter';
import { ScheduleRunCoordinator } from './schedule-run-coordinator';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

export { ScheduleTargetGoneError } from './schedule-run-executor';

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
  /** Schedule work runs in Engine's root FiberSet; local handles provide targeted draining. */
  private readonly inFlight = new Set<Fiber.Fiber<void>>();
  private readonly now: () => number;
  private readonly cadence: ScheduleCadenceCalculator;
  private readonly reporter: ScheduleReporter;
  private readonly runCoordinator: ScheduleRunCoordinator;
  private readonly tickMs: number;
  private readonly defaultMisfirePolicy: ScheduleMisfirePolicy;
  private cadenceFiber: Fiber.Fiber<void> | undefined;
  private runTask: RunTask | undefined;
  private acceptingRuns = true;
  private seq = 0;

  constructor(
    transport: Transport,
    private readonly store: ScheduleStore,
    driver: SessionDriver,
    options: ScheduleServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.cadence = new ScheduleCadenceCalculator(this.now);
    this.reporter = new ScheduleReporter(transport);
    this.runCoordinator = new ScheduleRunCoordinator(store, driver, this.reporter, this.now, {
      launch: (effect) => this.launch(effect),
      settle: (scheduleId, trigger, endedAt) =>
        this.serialized(() => this.settleScheduleAfterRun(scheduleId, trigger, endedAt)),
      targetGone: (scheduleId) =>
        this.serialized(() => {
          const schedule = this.schedules.get(scheduleId);
          return schedule ? this.complete(schedule, 'targetGone') : Effect.void;
        }),
    });
    this.tickMs = options.tickMs ?? 1000;
    this.defaultMisfirePolicy = options.defaultMisfirePolicy ?? 'catch-up';
  }

  bindRuntime(runTask: RunTask): void {
    this.runTask = runTask;
  }

  start(): Effect.Effect<void, OperationError> {
    return storeEffect('schedules.load', 'Failed to recover schedules', () =>
      this.store.load(),
    ).pipe(
      Effect.tap((schedules) =>
        Effect.sync(() =>
          schedules.forEach((schedule) => this.schedules.set(schedule.scheduleId, schedule)),
        ),
      ),
      Effect.andThen(this.runCoordinator.recover(this.schedules.values())),
      Effect.tap(() =>
        Effect.sync(() => {
          if (this.cadenceFiber) return;
          const tick = this.tickOnce().pipe(
            Effect.catch((error) => Effect.logError('Schedule tick failed', error)),
          );
          const forkTick = Effect.sync(() => this.track(tick));
          const tickCycle = Effect.asVoid(Effect.flatMap(forkTick, Fiber.await));
          const cadence = Effect.sleep(this.tickMs).pipe(
            Effect.andThen(tickCycle.pipe(Effect.repeat(EffectSchedule.spaced(this.tickMs)))),
            Effect.asVoid,
          );
          this.cadenceFiber = this.track(cadence);
        }),
      ),
      Effect.asVoid,
    );
  }

  shutdown(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.acceptingRuns = false;
      this.cadenceFiber?.interruptUnsafe();
      this.cadenceFiber = undefined;
    }).pipe(
      Effect.andThen(this.serialized(() => Effect.void)),
      Effect.andThen(Effect.suspend(() => this.settleTasks())),
      Effect.andThen(Effect.suspend(() => this.runCoordinator.settleAll())),
    );
  }

  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  /** Resolves once no run is in flight. Test-only seam — the tick never awaits runs. */
  settleAll(): Effect.Effect<void> {
    return this.runCoordinator.settleAll();
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
  runOnce(scheduleId: ScheduleId): Effect.Effect<void, RequestError | OperationError> {
    return this.serialized((): Effect.Effect<void, RequestError | OperationError> => {
      if (!this.acceptingRuns) {
        return Effect.fail(conflict('Schedule service is shutting down'));
      }
      return this.find(scheduleId).pipe(
        Effect.flatMap((schedule): Effect.Effect<void, RequestError | OperationError> => {
          if (schedule.status === 'completed') {
            return Effect.fail(conflict('Schedule is already completed'));
          }
          if (this.runCoordinator.isActive(scheduleId)) {
            return Effect.fail(conflict('Schedule run already in progress'));
          }
          return this.startRun(schedule, 'manual');
        }),
      );
    });
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
  tickOnce(): Effect.Effect<void, OperationError> {
    const fireDue = this.fireDue.bind(this);
    const isAcceptingRuns = (): boolean => this.acceptingRuns;
    return this.serialized(() => {
      if (!isAcceptingRuns()) return Effect.void;
      const now = this.now();
      const due = [...this.schedules.values()].filter(
        (schedule) =>
          schedule.status === 'active' &&
          schedule.nextRunAt !== undefined &&
          !this.runCoordinator.isActive(schedule.scheduleId) &&
          schedule.nextRunAt <= now,
      );
      return Effect.forEach(
        due,
        (schedule) => (isAcceptingRuns() ? fireDue(schedule, now) : Effect.void),
        { discard: true },
      );
    });
  }

  /**
   * A due schedule: complete it if expired; otherwise advance `nextRunAt` past now (before launching,
   * so a slow run can't double-fire), then either replay the most recent missed occurrence within
   * the grace window (a catch-up) or record it skipped.
   */
  private fireDue(schedule: Schedule, now: number): Effect.Effect<void, OperationError> {
    const cadenceService = this.cadence;
    const complete = this.complete.bind(this);
    const defaultMisfirePolicy = this.defaultMisfirePolicy;
    const recordSkipped = this.recordSkipped.bind(this);
    const startRun = this.startRun.bind(this);
    const catchUpThresholdMs = this.catchUpThresholdMs();
    const isAcceptingRuns = (): boolean => this.acceptingRuns;
    const { reporter, schedules, store } = this;
    return Effect.gen(function* () {
      if (schedule.spec.expiresAt !== undefined && schedule.spec.expiresAt <= now) {
        yield* complete(schedule, 'expired');
        return;
      }
      const cadence = schedule.spec.cadence;
      const latestMissed = cadenceService.latestAtOrBefore(cadence, schedule.nextRunAt ?? now, now);
      const missedBy = now - latestMissed;
      const advanced: Schedule = {
        ...schedule,
        nextRunAt: cadenceService.next(cadence, latestMissed),
        updatedAt: now,
      };
      yield* storeEffect('schedules.save', 'Failed to advance schedule', () =>
        store.save(advanced),
      );
      schedules.set(advanced.scheduleId, advanced);
      reporter.changed(advanced);

      // On-time fires (within the catch-up threshold) always run, whatever the policy.
      const isMiss = missedBy > catchUpThresholdMs;
      if (isMiss) {
        const policy = advanced.spec.misfirePolicy ?? defaultMisfirePolicy;
        // `skip` fast-forwards silently (nextRunAt already advanced); `catch-up` beyond grace records
        // a skipped run for visibility; within grace it replays the most recent missed occurrence.
        if (policy === 'skip') return;
        if (missedBy > cadenceService.graceMs(cadence)) {
          yield* recordSkipped(advanced, latestMissed, now);
          return;
        }
      }
      if (isAcceptingRuns()) {
        yield* startRun(advanced, isMiss ? 'catch-up' : 'cadence');
      }
    });
  }

  private startRun(
    schedule: Schedule,
    trigger: ScheduleRunTrigger,
  ): Effect.Effect<void, OperationError> {
    return this.runCoordinator.start(schedule, this.mintRunId(), trigger);
  }

  /** Track Engine-owned schedule work for targeted shutdown without creating another Runtime. */
  private track(effect: Effect.Effect<void, unknown>): Fiber.Fiber<void> {
    const fiber = this.launch(effect);
    this.inFlight.add(fiber);
    fiber.addObserver(() => this.inFlight.delete(fiber));
    return fiber;
  }

  private launch(effect: Effect.Effect<void, unknown>): Fiber.Fiber<void> {
    const run = nullthrow(this.runTask, 'Schedule runtime has not started');
    return run(
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError('Schedule task failed', Cause.squash(cause)),
        ),
      ),
    );
  }

  private settleTasks(): Effect.Effect<void> {
    return Effect.asVoid(Effect.all([...this.inFlight].map((fiber) => Fiber.await(fiber))));
  }

  /** Bookkeeping once a run settles: count scheduled runs toward maxRuns; record lastRunAt. */
  private settleScheduleAfterRun(
    scheduleId: ScheduleId,
    trigger: ScheduleRunTrigger,
    endedAt: number,
  ): Effect.Effect<void, OperationError> {
    const schedule = this.schedules.get(scheduleId);
    // A schedule completed mid-run (targetGone) is terminal; leave it alone.
    if (schedule?.status !== 'active') return Effect.void;
    const settled: Schedule = {
      ...schedule,
      lastRunAt: endedAt,
      runCount: trigger === 'manual' ? schedule.runCount : schedule.runCount + 1,
      updatedAt: this.now(),
    };
    if (trigger !== 'manual' && this.reachedMaxRuns(settled)) {
      return this.complete(settled, 'maxRuns');
    }
    return storeEffect('schedules.save', 'Failed to settle schedule run', () =>
      this.store.save(settled),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.schedules.set(scheduleId, settled);
          this.reporter.changed(settled);
        }),
      ),
    );
  }

  private recordSkipped(
    schedule: Schedule,
    scheduledFor: number,
    now: number,
  ): Effect.Effect<void, OperationError> {
    const run: ScheduleRun = {
      runId: this.mintRunId(),
      scheduleId: schedule.scheduleId,
      status: 'skipped',
      trigger: 'catch-up',
      error: 'missed run window elapsed beyond the grace period',
      startedAt: scheduledFor,
      endedAt: now,
    };
    return this.runCoordinator.recordSkipped(run);
  }

  private complete(
    schedule: Schedule,
    reason: Schedule['completedReason'],
  ): Effect.Effect<void, OperationError> {
    const completed: Schedule = {
      ...schedule,
      status: 'completed',
      completedReason: reason,
      nextRunAt: undefined,
      updatedAt: this.now(),
    };
    return storeEffect('schedules.save', 'Failed to complete schedule', () =>
      this.store.save(completed),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.schedules.set(completed.scheduleId, completed);
          this.reporter.changed(completed);
        }),
      ),
    );
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
