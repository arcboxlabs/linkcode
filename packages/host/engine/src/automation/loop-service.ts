import type {
  LoopId,
  LoopIteration,
  LoopLogEntry,
  LoopLogLevel,
  LoopRecord,
  LoopSpec,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { LoopIterationRunner } from './loop-iteration-runner';
import { LoopReporter } from './loop-reporter';
import type { LoopStore } from './loop-store';
import type { SessionDriver } from './session-driver';

const SUMMARY_MAX_CHARS = 2000;

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
  private readonly controllers = new Map<LoopId, AbortController>();
  /** In-flight loop promises, kept only so {@link settleAll} can await them in tests. */
  private readonly inFlight = new Map<LoopId, Promise<void>>();
  private readonly now: () => number;
  private readonly reporter: LoopReporter;
  private readonly iterationRunner: LoopIterationRunner;
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

  shutdown(): void {
    for (const controller of this.controllers.values()) controller.abort();
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

  async startLoop(spec: LoopSpec): Promise<LoopRecord> {
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
    this.reporter.start(loop.loopId);
    await this.store.save(loop);
    this.reporter.changed(loop);
    this.reporter.log(loop.loopId, 'info', 'system', 'loop started');

    const controller = new AbortController();
    this.controllers.set(loop.loopId, controller);
    this.track(loop.loopId, this.runLoop(loop, controller.signal));
    return loop;
  }

  /** Signal a running loop to stop; it settles to `stopped` after the current turn unwinds. */
  stopLoop(loopId: LoopId): void {
    this.require(loopId);
    this.controllers.get(loopId)?.abort();
  }

  async deleteLoop(loopId: LoopId): Promise<void> {
    const loop = this.require(loopId);
    if (loop.status === 'running') throw new Error('stop the loop before deleting it');
    this.loops.delete(loopId);
    await this.store.delete(loopId);
    this.reporter.remove(loopId);
  }

  /** Resolves once no loop is in flight. Test-only seam — nothing else awaits the runners. */
  async settleAll(): Promise<void> {
    await Promise.all(this.inFlight.values());
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
    this.controllers.delete(loop.loopId);
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

  private track(loopId: LoopId, run: Promise<void>): void {
    const wrapped = run
      .catch((err: unknown) => {
        console.error('Loop run failed:', err);
      })
      .finally(() => {
        if (this.inFlight.get(loopId) === wrapped) this.inFlight.delete(loopId);
      });
    this.inFlight.set(loopId, wrapped);
  }

  private mintLoopId(): LoopId {
    this.seq += 1;
    return `loop-${this.now().toString(36)}-${this.seq.toString(36)}` as LoopId;
  }
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
