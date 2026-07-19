import type {
  LoopId,
  LoopIteration,
  LoopLogEntry,
  LoopLogLevel,
  LoopRecord,
  LoopSpec,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Cause, Effect, Exit, Fiber } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { LoopIterationRunner } from './loop-iteration-runner';
import { LoopReporter } from './loop-reporter';
import type { LoopStore } from './loop-store';
import type { SessionDriver } from './session-driver';

const SUMMARY_MAX_CHARS = 2000;

type RunTask = (effect: Effect.Effect<void>) => Fiber.Fiber<void>;

interface LoopHandle {
  readonly control: LoopControl;
  readonly fiber: Fiber.Fiber<void>;
}

interface LoopControl {
  admitted: boolean;
  stopError?: string;
  terminalStarted: boolean;
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
  private readonly iterationRunner: LoopIterationRunner;
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
    this.iterationRunner = new LoopIterationRunner(driver, store, this.reporter, this.now);
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
        handle.control.stopError ??= 'engine shutting down';
        if (handle.control.admitted) handle.fiber.interruptUnsafe();
      }
    }).pipe(Effect.andThen(Effect.suspend(() => this.settleAll())));
  }

  list(): LoopRecord[] {
    return [...this.loops.values()];
  }

  async inspect(
    loopId: LoopId,
  ): Promise<{ loop: LoopRecord; iterations: LoopIteration[]; logs: LoopLogEntry[] }> {
    const loop = this.require(loopId);
    const iterations = await this.store.loadIterations(loopId);
    return { loop, iterations, logs: this.reporter.snapshot(loopId) };
  }

  startLoop(spec: LoopSpec): Promise<LoopRecord> {
    if (!this.acceptingLoops) return Promise.reject(new Error('Loop service is shutting down'));
    const now = this.now();
    const loop: LoopRecord = {
      loopId: this.mintLoopId(),
      spec,
      status: 'running',
      iterationCount: 0,
      startedAt: now,
      updatedAt: now,
    };
    this.loops.set(loop.loopId, loop);
    const control: LoopControl = { admitted: false, terminalStarted: false };
    let resolveAdmission: (record: LoopRecord) => void;
    let rejectAdmission: (cause: unknown) => void;
    const admission = new Promise<LoopRecord>((resolve, reject) => {
      resolveAdmission = resolve;
      rejectAdmission = reject;
    });
    const finish = (error: string) => this.finish(loop, control, 'stopped', error);
    const runLoop = () => this.runLoop(loop, control);
    const { reporter, store } = this;
    const effect = Effect.gen(function* () {
      yield* fromPromise(() => store.save(loop));
      reporter.start(loop.loopId);
      control.admitted = true;
      resolveAdmission(loop);
      if (control.stopError !== undefined) {
        yield* finish(control.stopError);
        return;
      }
      reporter.changed(loop);
      reporter.log(loop.loopId, 'info', 'system', 'loop started');
      yield* runLoop();
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (control.admitted) return;
          this.loops.delete(loop.loopId);
          rejectAdmission(
            Exit.isFailure(exit) ? Cause.squash(exit.cause) : new Error('Loop stopped'),
          );
        }),
      ),
    );
    this.track(loop.loopId, control, effect);
    return admission;
  }

  /** Signal a running loop to stop; it settles to `stopped` after the current turn unwinds. */
  stopLoop(loopId: LoopId): void {
    this.require(loopId);
    const handle = this.handles.get(loopId);
    if (!handle) return;
    handle.control.stopError ??= 'stopped by user';
    if (handle.control.admitted) handle.fiber.interruptUnsafe();
  }

  async deleteLoop(loopId: LoopId): Promise<void> {
    this.require(loopId);
    if (this.handles.has(loopId)) throw new Error('stop the loop before deleting it');
    this.loops.delete(loopId);
    await this.store.delete(loopId);
    this.reporter.remove(loopId);
  }

  /** Resolves once all accepted loop fibers finish persistence, reporting, and session cleanup. */
  settleAll(): Effect.Effect<void> {
    return Effect.asVoid(
      Effect.all([...this.handles.values()].map(({ fiber }) => Fiber.await(fiber))),
    );
  }

  // ── The loop runner ──────────────────────────────────────────────────────

  private runLoop(loop: LoopRecord, control: LoopControl): Effect.Effect<void, unknown> {
    const spec = loop.spec;
    const { iterationRunner, now, reporter, store } = this;
    const finish = this.finish.bind(this, loop, control);
    const summarize = (text: string) => this.summarize(text);
    let lastFailure: string | undefined;
    const budgetRemaining =
      spec.maxTimeMs === undefined
        ? undefined
        : Math.max(0, spec.maxTimeMs - (now() - loop.startedAt));
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
        Cause.hasInterruptsOnly(cause) || control.terminalStarted
          ? Effect.failCause(cause)
          : finish('failed', extractErrorMessage(Cause.squash(cause), false) ?? 'loop failed'),
      ),
      Effect.onInterrupt(() =>
        control.stopError === undefined ? Effect.void : finish('stopped', control.stopError),
      ),
    );
    return budgetRemaining === undefined
      ? run
      : run.pipe(
          Effect.timeoutOrElse({
            duration: budgetRemaining,
            orElse: () => finish('failed', 'time budget exceeded'),
          }),
        );
  }

  private finish(
    loop: LoopRecord,
    control: LoopControl,
    status: LoopRecord['status'],
    error?: string,
    summary?: string,
  ): Effect.Effect<void, unknown> {
    return Effect.suspend(() => {
      if (control.terminalStarted) return Effect.void;
      control.terminalStarted = true;
      return Effect.sync(() => {
        loop.status = status;
        loop.error = error;
        if (summary !== undefined) loop.summary = summary;
        loop.endedAt = this.now();
        loop.updatedAt = this.now();
      }).pipe(
        Effect.andThen(fromPromise(() => this.store.save(loop))),
        Effect.andThen(
          Effect.sync(() => {
            this.reporter.changed(loop);
            const level: LoopLogLevel =
              status === 'succeeded' ? 'info' : status === 'failed' ? 'error' : 'warn';
            this.reporter.log(
              loop.loopId,
              level,
              'system',
              `loop ${status}${error ? `: ${error}` : ''}`,
            );
          }),
        ),
      );
    }).pipe(Effect.uninterruptible);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private summarize(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return trimmed.length > SUMMARY_MAX_CHARS ? trimmed.slice(0, SUMMARY_MAX_CHARS) : trimmed;
  }

  private require(loopId: LoopId): LoopRecord {
    return nullthrow(this.loops.get(loopId), `Unknown loop: ${loopId}`);
  }

  private track(loopId: LoopId, control: LoopControl, effect: Effect.Effect<void, unknown>): void {
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
    const handle = { control, fiber };
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

function fromPromise<A>(run: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause });
}
