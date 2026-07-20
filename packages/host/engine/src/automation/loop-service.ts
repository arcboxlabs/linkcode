import type { LoopId, LoopIteration, LoopLogEntry, LoopRecord, LoopSpec } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Cause, Effect, Fiber } from 'effect';
import { nullthrow } from 'foxts/guard';
import { OperationError, RequestError } from '../failure';
import { LoopIterationRunner } from './loop-iteration-runner';
import { LoopReporter } from './loop-reporter';
import type { LoopRun } from './loop-run-coordinator';
import { LoopRunCoordinator } from './loop-run-coordinator';
import type { LoopStore } from './loop-store';
import type { SessionDriver } from './session-driver';

type RunTask = (effect: Effect.Effect<void>) => Fiber.Fiber<void>;

interface LoopHandle {
  readonly run: LoopRun;
  readonly fiber: Fiber.Fiber<void>;
}
export interface LoopServiceOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Owns the iterate-until-verified loops. Each loop runs fire-and-forget: a fresh worker session per
 * iteration (with the prior failure fed back into the prompt), then shell verify-checks, then an
 * optional structured verifier — repeating until something passes or a bound is hit. Progress is
 * broadcast (`loop.changed` / `loop.iteration` / `loop.log`) so clients fold it from the
 * `loop.list` / `loop.inspect` snapshots. The service never imports the Engine — it drives sessions
 * only through the injected {@link SessionDriver}.
 */
export class LoopService {
  private readonly loops = new Map<LoopId, LoopRecord>();
  /** Loop fibers run in Engine's root FiberSet; handles provide per-loop cancellation and draining. */
  private readonly handles = new Map<LoopId, LoopHandle>();
  private readonly now: () => number;
  private readonly reporter: LoopReporter;
  private readonly runCoordinator: LoopRunCoordinator;
  private runTask: RunTask | undefined;
  private acceptingLoops = true;
  private seq = 0;

  constructor(
    transport: Transport,
    private readonly store: LoopStore,
    driver: SessionDriver,
    options: LoopServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.reporter = new LoopReporter(transport, this.now);
    const iterationRunner = new LoopIterationRunner(driver, store, this.reporter, this.now);
    this.runCoordinator = new LoopRunCoordinator(iterationRunner, store, this.reporter, this.now);
  }

  bindRuntime(runTask: RunTask): void {
    this.runTask = runTask;
  }

  async start(): Promise<void> {
    for (const loop of await this.store.load()) {
      this.loops.set(loop.loopId, loop);
    }
    // A loop is a single bounded job; a restart cannot resume its worker sessions, so mark any that
    // were mid-run as stopped rather than pretending to continue.
    for (const loop of await this.store.loadRunning()) {
      loop.status = 'stopped';
      loop.error = 'daemon restarted before the loop finished';
      loop.endedAt = this.now();
      loop.updatedAt = this.now();
      this.loops.set(loop.loopId, loop);
      await this.store.save(loop);
    }
  }

  shutdown(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.acceptingLoops = false;
      for (const handle of this.handles.values()) {
        if (handle.run.requestStop('engine shutting down')) handle.fiber.interruptUnsafe();
      }
    }).pipe(Effect.andThen(Effect.suspend(() => this.settleAll())));
  }

  list(): LoopRecord[] {
    return [...this.loops.values()];
  }

  inspect(
    loopId: LoopId,
  ): Effect.Effect<
    { loop: LoopRecord; iterations: LoopIteration[]; logs: LoopLogEntry[] },
    RequestError | OperationError
  > {
    return this.find(loopId).pipe(
      Effect.flatMap((loop) =>
        storeEffect('loops.iterations.load', 'Failed to inspect loop', () =>
          this.store.loadIterations(loopId),
        ).pipe(
          Effect.map((iterations) => ({
            loop,
            iterations,
            logs: this.reporter.snapshot(loopId),
          })),
        ),
      ),
    );
  }

  startLoop(spec: LoopSpec): Effect.Effect<LoopRecord, RequestError | OperationError> {
    return Effect.suspend((): Effect.Effect<LoopRecord, RequestError | OperationError> => {
      if (!this.acceptingLoops) {
        return Effect.fail(conflict('Loop service is shutting down'));
      }
      const now = this.now();
      const loop: LoopRecord = {
        loopId: this.mintLoopId(),
        spec,
        status: 'running',
        iterationCount: 0,
        startedAt: now,
        updatedAt: now,
      };
      const run = this.runCoordinator.createRun(loop);
      const { store } = this;
      const effect = run.execute().pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            if (run.isAdmitted()) return;
            this.loops.delete(loop.loopId);
          }),
        ),
      );
      const admit = storeEffect('loops.save', 'Failed to start loop', () => store.save(loop)).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            this.loops.set(loop.loopId, loop);
            if (this.acceptingLoops) {
              this.track(loop.loopId, run, effect);
              return Effect.void;
            }
            return run.settleWithoutStarting('engine shutting down');
          }),
        ),
        Effect.as(loop),
      );
      return Effect.uninterruptible(admit);
    });
  }

  /** Signal a running loop to stop; it settles to `stopped` after the current turn unwinds. */
  stopLoop(loopId: LoopId): Effect.Effect<void, RequestError> {
    return this.find(loopId).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          const handle = this.handles.get(loopId);
          if (!handle) return;
          if (handle.run.requestStop('stopped by user')) handle.fiber.interruptUnsafe();
        }),
      ),
      Effect.asVoid,
    );
  }

  deleteLoop(loopId: LoopId): Effect.Effect<void, RequestError | OperationError> {
    return this.find(loopId).pipe(
      Effect.flatMap((): Effect.Effect<void, RequestError | OperationError> => {
        if (this.handles.has(loopId)) {
          return Effect.fail(conflict('Stop the loop before deleting it'));
        }
        return storeEffect('loops.delete', 'Failed to delete loop', () =>
          this.store.delete(loopId),
        );
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          this.loops.delete(loopId);
          this.reporter.remove(loopId);
        }),
      ),
    );
  }

  /** Resolves once all accepted loop fibers finish persistence, reporting, and session cleanup. */
  settleAll(): Effect.Effect<void> {
    return Effect.asVoid(
      Effect.all([...this.handles.values()].map(({ fiber }) => Fiber.await(fiber))),
    );
  }

  private find(loopId: LoopId): Effect.Effect<LoopRecord, RequestError> {
    const loop = this.loops.get(loopId);
    return loop
      ? Effect.succeed(loop)
      : Effect.fail(new RequestError({ code: 'not_found', message: 'Loop not found' }));
  }

  private track(loopId: LoopId, loopRun: LoopRun, effect: Effect.Effect<void, unknown>): void {
    const run = nullthrow(this.runTask, 'Loop runtime has not started');
    const fiber = run(
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logError('Loop task failed', Cause.squash(cause)),
        ),
      ),
    );
    const handle = { run: loopRun, fiber };
    this.handles.set(loopId, handle);
    fiber.addObserver(() => {
      if (this.handles.get(loopId) === handle) this.handles.delete(loopId);
    });
  }

  private mintLoopId(): LoopId {
    this.seq += 1;
    return `loop-${this.now().toString(36)}-${this.seq.toString(36)}` as LoopId;
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

function conflict(message: string): RequestError {
  return new RequestError({ code: 'conflict', message });
}
