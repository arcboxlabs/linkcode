import type { LoopLogLevel, LoopRecord } from '@linkcode/schema';
import { Cause, Effect } from 'effect';
import { OperationError } from '../failure';
import type { LoopIterationRunner } from './loop-iteration-runner';
import type { LoopReporter } from './loop-reporter';
import type { LoopStore } from './loop-store';

const SUMMARY_MAX_CHARS = 2000;

export class LoopRun {
  private admitted = false;
  private stopError: string | undefined;
  private terminalStarted = false;

  constructor(
    private readonly loop: LoopRecord,
    private readonly iterationRunner: LoopIterationRunner,
    private readonly store: LoopStore,
    private readonly reporter: LoopReporter,
    private readonly now: () => number,
  ) {}

  requestStop(error: string): boolean {
    this.stopError ??= error;
    return this.admitted;
  }

  isAdmitted(): boolean {
    return this.admitted;
  }

  execute(): Effect.Effect<void, unknown> {
    const { loop, reporter } = this;
    const admit = () => {
      this.admitted = true;
    };
    const stopError = () => this.stopError;
    const finish = this.finish.bind(this);
    const runIterations = this.runIterations.bind(this);
    return Effect.gen(function* () {
      reporter.start(loop.loopId);
      admit();
      const requestedStop = stopError();
      if (requestedStop !== undefined) {
        yield* finish('stopped', requestedStop);
        return;
      }
      reporter.changed(loop);
      reporter.log(loop.loopId, 'info', 'system', 'loop started');
      yield* runIterations();
    });
  }

  settleWithoutStarting(error: string): Effect.Effect<void, OperationError> {
    this.loop.status = 'stopped';
    this.loop.error = error;
    this.loop.endedAt = this.now();
    this.loop.updatedAt = this.now();
    return Effect.tryPromise({
      try: () => this.store.save(this.loop),
      catch: (cause) =>
        new OperationError({
          subsystem: 'store',
          operation: 'loops.save',
          publicMessage: 'Failed to stop loop during shutdown',
          cause,
        }),
    }).pipe(Effect.tap(() => Effect.sync(() => this.reporter.changed(this.loop))));
  }

  private runIterations(): Effect.Effect<void, unknown> {
    const { iterationRunner, loop, now, reporter, store } = this;
    const spec = loop.spec;
    let lastFailure: string | undefined;
    const budgetRemaining =
      spec.maxTimeMs === undefined
        ? undefined
        : Math.max(0, spec.maxTimeMs - (now() - loop.startedAt));
    const finish = this.finish.bind(this);
    const run = Effect.gen(function* () {
      for (let index = 0; index < spec.maxIterations; index += 1) {
        const { iteration, workerText, failureFeedback } = yield* iterationRunner.run(
          loop,
          index,
          lastFailure,
        );
        loop.iterationCount = index + 1;
        loop.updatedAt = now();
        yield* fromPromise(() => store.save(loop));
        reporter.changed(loop);
        if (iteration.status === 'passed') {
          yield* finish('succeeded', undefined, summarize(workerText));
          return;
        }
        lastFailure = failureFeedback;
        if (spec.sleepMs > 0) yield* Effect.sleep(spec.sleepMs);
      }
      yield* finish('failed', 'max iterations reached without passing verification');
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) || this.terminalStarted
          ? Effect.failCause(cause)
          : Effect.logError(
              'Loop run failed',
              {
                loopId: loop.loopId,
                operation: 'automation.loop.run',
              },
              Cause.squash(cause),
            ).pipe(Effect.andThen(this.finish('failed', 'automation loop failed'))),
      ),
      Effect.onInterrupt(() =>
        this.stopError === undefined ? Effect.void : this.finish('stopped', this.stopError),
      ),
    );
    return budgetRemaining === undefined
      ? run
      : run.pipe(
          Effect.timeoutOrElse({
            duration: budgetRemaining,
            orElse: () => this.finish('failed', 'time budget exceeded'),
          }),
        );
  }

  private finish(
    status: LoopRecord['status'],
    error?: string,
    summary?: string,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (this.terminalStarted) return Effect.void;
      this.terminalStarted = true;
      return Effect.sync(() => {
        this.loop.status = status;
        this.loop.error = error;
        if (summary !== undefined) this.loop.summary = summary;
        this.loop.endedAt = this.now();
        this.loop.updatedAt = this.now();
      }).pipe(
        Effect.andThen(fromPromise(() => this.store.save(this.loop))),
        Effect.andThen(
          Effect.sync(() => {
            this.reporter.changed(this.loop);
            const level: LoopLogLevel =
              status === 'succeeded' ? 'info' : status === 'failed' ? 'error' : 'warn';
            this.reporter.log(
              this.loop.loopId,
              level,
              'system',
              `loop ${status}${error ? `: ${error}` : ''}`,
            );
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }
}

/** Coordinates one admitted loop from its first iteration through durable terminal settlement. */
export class LoopRunCoordinator {
  constructor(
    private readonly iterationRunner: LoopIterationRunner,
    private readonly store: LoopStore,
    private readonly reporter: LoopReporter,
    private readonly now: () => number,
  ) {}

  createRun(loop: LoopRecord): LoopRun {
    return new LoopRun(loop, this.iterationRunner, this.store, this.reporter, this.now);
  }
}

function summarize(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > SUMMARY_MAX_CHARS ? trimmed.slice(0, SUMMARY_MAX_CHARS) : trimmed;
}

function fromPromise<A>(run: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause });
}
