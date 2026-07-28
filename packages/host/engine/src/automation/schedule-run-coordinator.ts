import type {
  Schedule,
  ScheduleId,
  ScheduleRun,
  ScheduleRunId,
  ScheduleRunTrigger,
} from '@linkcode/schema';
import { Cause, Effect, Fiber } from 'effect';
import { nullthrow } from 'foxts/guard';
import { OperationError } from '../failure';
import { automationFailureMessage } from './failure';
import type { ScheduleReporter } from './schedule-reporter';
import { ScheduleRunExecutor, ScheduleTargetGoneError } from './schedule-run-executor';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

const RUNS_KEPT_PER_SCHEDULE = 100;

interface ScheduleRunCoordinatorCallbacks {
  readonly launch: (effect: Effect.Effect<void, unknown>) => Fiber.Fiber<void>;
  readonly settle: (
    scheduleId: ScheduleId,
    trigger: ScheduleRunTrigger,
    endedAt: number,
  ) => Effect.Effect<void, OperationError>;
  readonly targetGone: (scheduleId: ScheduleId) => Effect.Effect<void, OperationError>;
}

/** Owns the durable lifecycle and single-flight state of individual schedule runs. */
export class ScheduleRunCoordinator {
  private readonly activeRuns = new Set<ScheduleId>();
  private readonly inFlight = new Set<Fiber.Fiber<void>>();
  private readonly executor: ScheduleRunExecutor;

  constructor(
    private readonly store: ScheduleStore,
    private readonly driver: SessionDriver,
    private readonly reporter: ScheduleReporter,
    private readonly now: () => number,
    private readonly callbacks: ScheduleRunCoordinatorCallbacks,
  ) {
    this.executor = new ScheduleRunExecutor(driver, store, reporter);
  }

  isActive(scheduleId: ScheduleId): boolean {
    return this.activeRuns.has(scheduleId);
  }

  start(
    schedule: Schedule,
    runId: ScheduleRunId,
    trigger: ScheduleRunTrigger,
  ): Effect.Effect<void, OperationError> {
    const run: ScheduleRun = {
      runId,
      scheduleId: schedule.scheduleId,
      status: 'running',
      trigger,
      startedAt: this.now(),
    };
    return this.saveRun(run).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.activeRuns.add(schedule.scheduleId);
          this.track(this.execute(schedule, run));
        }),
      ),
    );
  }

  recordSkipped(run: ScheduleRun): Effect.Effect<void, OperationError> {
    return this.saveRun(run).pipe(Effect.andThen(this.prune(run.scheduleId)));
  }

  /** Waits until the dynamically changing run set is empty. */
  settleAll(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const fibers = [...this.inFlight];
      if (fibers.length === 0) return Effect.void;
      return Effect.asVoid(Effect.all(fibers.map((fiber) => Fiber.await(fiber)))).pipe(
        Effect.andThen(Effect.suspend(() => this.settleAll())),
      );
    });
  }

  recover(schedules: Iterable<Schedule>): Effect.Effect<void, OperationError> {
    const { callbacks, driver, now, store } = this;
    const saveRun = this.saveRun.bind(this);
    return Effect.gen(function* () {
      const running = yield* storeEffect(
        'schedule-runs.load-running',
        'Failed to recover schedule runs',
        () => store.loadRunningRuns(),
      );
      for (const run of running) {
        yield* saveRun({
          ...run,
          status: 'failed',
          error: 'daemon restarted before the run completed',
          endedAt: now(),
        });
      }
      for (const schedule of schedules) {
        if (schedule.status !== 'active') continue;
        const target = schedule.spec.target;
        if (target.type === 'session' && !driver.hasRecord(target.sessionId)) {
          yield* callbacks.targetGone(schedule.scheduleId);
        }
      }
    });
  }

  private execute(schedule: Schedule, run: ScheduleRun): Effect.Effect<void, unknown> {
    const scheduleId = schedule.scheduleId;
    const { callbacks } = this;
    return this.executor.execute(schedule, run).pipe(
      Effect.matchEffect({
        onFailure(error) {
          run.status = 'failed';
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
          return error instanceof ScheduleTargetGoneError
            ? diagnostic.pipe(Effect.andThen(callbacks.targetGone(scheduleId)))
            : diagnostic;
        },
        onSuccess: (outcome) =>
          Effect.sync(() => {
            run.status = 'succeeded';
            run.sessionId = outcome.sessionId;
            run.summary = outcome.summary;
          }),
      }),
      Effect.andThen(
        Effect.suspend(() => {
          run.endedAt = this.now();
          return this.saveRun(run);
        }),
      ),
      Effect.andThen(this.prune(scheduleId)),
      Effect.andThen(
        Effect.suspend(() => callbacks.settle(scheduleId, run.trigger, nullthrow(run.endedAt))),
      ),
      Effect.ensuring(Effect.sync(() => this.activeRuns.delete(scheduleId))),
      Effect.asVoid,
    );
  }

  private track(effect: Effect.Effect<void, unknown>): void {
    const fiber = this.callbacks.launch(
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

  private saveRun(run: ScheduleRun): Effect.Effect<void, OperationError> {
    return storeEffect('schedule-runs.save', 'Failed to save schedule run', () =>
      this.store.saveRun(run),
    ).pipe(Effect.tap(() => Effect.sync(() => this.reporter.runChanged(run))));
  }

  private prune(scheduleId: ScheduleId): Effect.Effect<void, OperationError> {
    return storeEffect('schedule-runs.prune', 'Failed to prune schedule runs', () =>
      this.store.pruneRuns(scheduleId, RUNS_KEPT_PER_SCHEDULE),
    );
  }
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
