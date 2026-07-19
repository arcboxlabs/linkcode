import type {
  LoopId,
  LoopIteration,
  LoopLogEntry,
  LoopLogLevel,
  LoopRecord,
  LoopSpec,
  LoopVerdict,
  SessionId,
} from '@linkcode/schema';
import { LoopVerdictSchema } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import {
  buildLoopVerifierPrompt,
  buildLoopWorkerPrompt,
  describeLoopFailure,
} from './loop-prompts';
import { LoopReporter } from './loop-reporter';
import type { LoopStore } from './loop-store';
import type { SessionDriver } from './session-driver';
import { runShellCheck } from './shell-exec';
import { promptForStructured } from './structured-response';

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
  private seq = 0;

  constructor(
    transport: Transport,
    private readonly store: LoopStore,
    private readonly driver: SessionDriver,
    options: LoopServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.reporter = new LoopReporter(transport, this.now);
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

        const { iteration, workerText } = await this.runIteration(
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

        lastFailure = describeLoopFailure(iteration);
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

  private async runIteration(
    loop: LoopRecord,
    index: number,
    lastFailure: string | undefined,
    signal: AbortSignal,
  ): Promise<{ iteration: LoopIteration; workerText: string }> {
    const iteration: LoopIteration = {
      loopId: loop.loopId,
      index,
      status: 'running',
      checks: [],
      startedAt: this.now(),
    };
    await this.saveIteration(iteration);
    this.reporter.log(loop.loopId, 'info', 'system', `iteration ${index + 1} started`, index);

    let workerText = '';
    try {
      workerText = await this.runWorkerTurn(loop, iteration, lastFailure, signal);
      const checksPassed = await this.runChecks(loop, iteration, signal);
      let verifierPassed = true;
      if (checksPassed && loop.spec.verifier) {
        const verdict = await this.runVerifierTurn(loop, iteration, workerText, signal);
        iteration.verdict = verdict;
        verifierPassed = verdict.passed;
      }
      iteration.status = checksPassed && verifierPassed ? 'passed' : 'failed';
    } catch (err) {
      iteration.status = 'failed';
      iteration.error = extractErrorMessage(err, false) ?? 'iteration failed';
      this.reporter.log(loop.loopId, 'error', 'system', iteration.error, index);
    }
    iteration.endedAt = this.now();
    await this.saveIteration(iteration);
    return { iteration, workerText };
  }

  private async runWorkerTurn(
    loop: LoopRecord,
    iteration: LoopIteration,
    lastFailure: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const sessionId = await this.driver.createSession({
      kind: loop.spec.kind,
      cwd: loop.spec.cwd,
      model: loop.spec.model,
      title: loop.spec.name ?? 'Loop worker',
      automation: { kind: 'loop', id: loop.loopId },
    });
    iteration.workerSessionId = sessionId;
    await this.saveIteration(iteration);
    return this.withAbortStop(sessionId, signal, async () => {
      await this.driver.makeUnattended(sessionId);
      const prompt = buildLoopWorkerPrompt(loop.spec, iteration.index, lastFailure);
      const result = await this.driver.prompt(sessionId, prompt, {
        timeoutMs: loop.spec.turnTimeoutMs,
      });
      this.reporter.log(loop.loopId, 'info', 'worker', result.text, iteration.index);
      return result.text;
    });
  }

  /** Run the shell checks in order, failing fast; each result is appended and streamed. */
  private async runChecks(
    loop: LoopRecord,
    iteration: LoopIteration,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (const command of loop.spec.verifyChecks) {
      if (signal.aborted) return false;
      const result = await runShellCheck(command, {
        cwd: loop.spec.cwd,
        timeoutMs: loop.spec.turnTimeoutMs,
        signal,
      });
      iteration.checks.push({ command, ...result });
      await this.saveIteration(iteration);
      this.reporter.log(
        loop.loopId,
        result.exitCode === 0 ? 'info' : 'warn',
        'check',
        `${command} → exit ${result.exitCode}`,
        iteration.index,
      );
      if (result.exitCode !== 0) return false;
    }
    return true;
  }

  private async runVerifierTurn(
    loop: LoopRecord,
    iteration: LoopIteration,
    workerText: string,
    signal: AbortSignal,
  ): Promise<LoopVerdict> {
    const verifier = nullthrow(loop.spec.verifier);
    const sessionId = await this.driver.createSession({
      kind: verifier.kind ?? loop.spec.kind,
      cwd: loop.spec.cwd,
      model: verifier.model,
      title: 'Loop verifier',
      automation: { kind: 'loop', id: loop.loopId },
    });
    iteration.verifierSessionId = sessionId;
    await this.saveIteration(iteration);
    return this.withAbortStop(sessionId, signal, async () => {
      await this.driver.makeUnattended(sessionId);
      const prompt = buildLoopVerifierPrompt(verifier.prompt, loop.spec.prompt, workerText);
      const verdict = await promptForStructured(this.driver, sessionId, prompt, LoopVerdictSchema, {
        timeoutMs: loop.spec.turnTimeoutMs,
      });
      this.reporter.log(
        loop.loopId,
        verdict.passed ? 'info' : 'warn',
        'verifier',
        verdict.reason,
        iteration.index,
      );
      return verdict;
    });
  }

  /** Run `fn` against a fresh session, killing that session if the loop is aborted mid-turn. */
  private async withAbortStop<T>(
    sessionId: SessionId,
    signal: AbortSignal,
    fn: () => Promise<T>,
  ): Promise<T> {
    const onAbort = (): void => {
      void this.driver.stopSession(sessionId).catch(noop);
    };
    if (signal.aborted) {
      await this.driver.stopSession(sessionId);
      throw new Error('loop aborted');
    }
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await fn();
    } finally {
      signal.removeEventListener('abort', onAbort);
      await this.driver.stopSession(sessionId);
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

  private async saveIteration(iteration: LoopIteration): Promise<void> {
    await this.store.saveIteration(iteration);
    this.reporter.iteration(iteration);
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
