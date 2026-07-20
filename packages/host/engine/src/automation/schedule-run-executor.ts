import type { Schedule, ScheduleRun, SessionId } from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError } from '../failure';
import { observeOperation } from '../observability';
import type { AutomationFailure } from './failure';
import { AutomationBusy, AutomationDispatchFailure, AutomationTargetGone } from './failure';
import type { ScheduleReporter } from './schedule-reporter';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

const SUMMARY_MAX_CHARS = 2000;

/** A run whose target no longer exists: the owning schedule can never fire again. */
export { AutomationTargetGone as ScheduleTargetGoneError };

export interface ScheduleRunOutcome {
  sessionId: SessionId;
  summary?: string;
}

/** Executes one schedule target while keeping its session link durable and observable. */
export class ScheduleRunExecutor {
  constructor(
    private readonly driver: SessionDriver,
    private readonly store: ScheduleStore,
    private readonly reporter: ScheduleReporter,
  ) {}

  execute(
    schedule: Schedule,
    run: ScheduleRun,
  ): Effect.Effect<ScheduleRunOutcome, AutomationFailure | OperationError> {
    const { driver } = this;
    const linkSession = (sessionId: SessionId) => this.linkSession(run, sessionId);
    return observeOperation(
      Effect.gen(function* () {
        const target = schedule.spec.target;
        if (target.type === 'session') {
          if (!driver.hasRecord(target.sessionId)) {
            return yield* Effect.fail(new AutomationTargetGone({}));
          }
          if (driver.isBusy(target.sessionId)) {
            return yield* Effect.fail(new AutomationBusy({}));
          }
          yield* driverCall((signal) => driver.ensureLive(target.sessionId, signal));
          yield* linkSession(target.sessionId);
          const result = yield* driverCall((signal) =>
            driver.prompt(target.sessionId, schedule.spec.prompt, { signal }),
          );
          return { sessionId: target.sessionId, summary: summarize(result.text) };
        }

        const sessionId = yield* driverCall((signal) =>
          driver.createSession({
            kind: target.config.kind,
            cwd: target.config.cwd,
            model: target.config.model,
            title: schedule.spec.name ?? 'Scheduled run',
            automation: { kind: 'schedule', id: schedule.scheduleId },
            signal,
          }),
        );
        yield* linkSession(sessionId);
        return yield* Effect.gen(function* () {
          yield* driverCall((signal) => driver.makeUnattended(sessionId, signal));
          const result = yield* driverCall((signal) =>
            driver.prompt(sessionId, schedule.spec.prompt, { signal }),
          );
          return { sessionId, summary: summarize(result.text) };
        }).pipe(
          // The record is kept (hidden from Threads); the run's summary is the durable output.
          Effect.onExit(() => driverCall(() => driver.stopSession(sessionId))),
        );
      }),
      {
        span: 'Schedule.run',
        subsystem: 'schedule',
        attributes: { scheduleId: schedule.scheduleId, runId: run.runId },
      },
    );
  }

  private linkSession(run: ScheduleRun, sessionId: SessionId): Effect.Effect<void, OperationError> {
    return Effect.sync(() => {
      run.sessionId = sessionId;
    }).pipe(
      Effect.andThen(
        Effect.tryPromise({
          try: () => this.store.saveRun(run),
          catch: (cause) =>
            new OperationError({
              subsystem: 'store',
              operation: 'schedule-runs.save',
              publicMessage: 'Failed to save schedule run',
              cause,
            }),
        }),
      ),
      Effect.andThen(Effect.sync(() => this.reporter.runChanged(run))),
    );
  }
}

function driverCall<A>(
  run: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, AutomationDispatchFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new AutomationDispatchFailure({ cause }),
  });
}

function summarize(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > SUMMARY_MAX_CHARS ? trimmed.slice(0, SUMMARY_MAX_CHARS) : trimmed;
}
