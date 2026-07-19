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
  readonly controller: AbortController;
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
      for (const handle of this.handles.values()) handle.controller.abort();
    }).pipe(Effect.andThen(this.settleAll()));
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
    const controller = new AbortController();
    let admissionSettled = false;
    let resolveAdmission: (record: LoopRecord) => void;
    let rejectAdmission: (cause: unknown) => void;
    const admission = new Promise<LoopRecord>((resolve, reject) => {
      resolveAdmission = resolve;
      rejectAdmission = reject;
    });
    const finish = (error: string) => this.finish(loop, 'stopped', error);
    const runLoop = () => this.runLoop(loop, controller.signal);
    const { reporter, store } = this;
    const effect = Effect.gen(function* () {
      yield* fromPromise(() => store.save(loop));
      reporter.start(loop.loopId);
      admissionSettled = true;
      resolveAdmission(loop);
      if (controller.signal.aborted) {
        yield* fromPromise(() => finish('engine shutting down'));
        return;
      }
      reporter.changed(loop);
      reporter.log(loop.loopId, 'info', 'system', 'loop started');
      yield* fromPromise(runLoop);
    }).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (admissionSettled) return;
          this.loops.delete(loop.loopId);
          rejectAdmission(
            Exit.isFailure(exit) ? Cause.squash(exit.cause) : new Error('Loop stopped'),
          );
        }),
      ),
    );
    this.track(loop.loopId, controller, effect);
    return admission;
  }

  /** Signal a running loop to stop; it settles to `stopped` after the current turn unwinds. */
  stopLoop(loopId: LoopId): void {
    this.require(loopId);
    this.handles.get(loopId)?.controller.abort();
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

  private async runLoop(loop: LoopRecord, signal: AbortSignal): Promise<void> {
    const spec = loop.spec;
    let lastFailure: string | undefined;
    const budgetController = new AbortController();
    const budgetRemaining =
      spec.maxTimeMs === undefined
        ? undefined
        : Math.max(0, spec.maxTimeMs - (this.now() - loop.startedAt));
    const budgetTimer =
      budgetRemaining === undefined
        ? undefined
        : setTimeout(() => budgetController.abort(), budgetRemaining);
    budgetTimer?.unref();
    const runSignal =
      budgetTimer === undefined ? signal : AbortSignal.any([signal, budgetController.signal]);
    const budgetExceeded = (): boolean =>
      budgetController.signal.aborted ||
      (spec.maxTimeMs !== undefined && this.now() - loop.startedAt >= spec.maxTimeMs);
    try {
      for (let index = 0; index < spec.maxIterations; index += 1) {
        if (signal.aborted) return await this.finish(loop, 'stopped', 'stopped by user');
        if (budgetExceeded()) {
          return await this.finish(loop, 'failed', 'time budget exceeded');
        }

        const { iteration, workerText, failureFeedback } = await this.iterationRunner.run(
          loop,
          index,
          lastFailure,
          runSignal,
        );
        loop.iterationCount = index + 1;
        loop.updatedAt = this.now();
        await this.store.save(loop);
        this.reporter.changed(loop);

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `signal.aborted` is a mutable getter; the loop-top narrowing doesn't survive the awaited iteration, and catching an abort here (vs. next loop turn) settles the final iteration as stopped rather than mislabeling it failed.
        if (signal.aborted) return await this.finish(loop, 'stopped', 'stopped by user');
        if (budgetExceeded()) return await this.finish(loop, 'failed', 'time budget exceeded');
        if (iteration.status === 'passed') {
          return await this.finish(loop, 'succeeded', undefined, this.summarize(workerText));
        }

        lastFailure = failureFeedback;
        if (spec.sleepMs > 0) await sleep(spec.sleepMs, runSignal);
      }
      await this.finish(loop, 'failed', 'max iterations reached without passing verification');
    } catch (err) {
      const message = extractErrorMessage(err, false) ?? 'loop failed';
      if (signal.aborted) await this.finish(loop, 'stopped', 'stopped by user');
      else if (budgetExceeded()) await this.finish(loop, 'failed', 'time budget exceeded');
      else await this.finish(loop, 'failed', message);
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
    }
  }

  private async finish(
    loop: LoopRecord,
    status: LoopRecord['status'],
    error?: string,
    summary?: string,
  ): Promise<void> {
    loop.status = status;
    loop.error = error;
    if (summary !== undefined) loop.summary = summary;
    loop.endedAt = this.now();
    loop.updatedAt = this.now();
    await this.store.save(loop);
    this.reporter.changed(loop);
    const level: LoopLogLevel =
      status === 'succeeded' ? 'info' : status === 'failed' ? 'error' : 'warn';
    this.reporter.log(loop.loopId, level, 'system', `loop ${status}${error ? `: ${error}` : ''}`);
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

  private track(
    loopId: LoopId,
    controller: AbortController,
    effect: Effect.Effect<void, unknown>,
  ): void {
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
    const handle = { controller, fiber };
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

/** Resolve after `ms`, or immediately when `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
