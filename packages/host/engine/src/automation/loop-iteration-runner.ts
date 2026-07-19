import type { LoopIteration, LoopRecord, LoopVerdict } from '@linkcode/schema';
import { LoopVerdictSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import {
  buildLoopVerifierPrompt,
  buildLoopWorkerPrompt,
  describeLoopFailure,
} from './loop-prompts';
import type { LoopReporter } from './loop-reporter';
import type { LoopStore } from './loop-store';
import type { SessionDriver } from './session-driver';
import { runShellCheck } from './shell-exec';
import { promptForStructured } from './structured-response';

export interface LoopIterationResult {
  iteration: LoopIteration;
  workerText: string;
  failureFeedback: string;
}

/** Runs one isolated worker/check/verifier attempt and records its observable progress. */
export class LoopIterationRunner {
  constructor(
    private readonly driver: SessionDriver,
    private readonly store: LoopStore,
    private readonly reporter: LoopReporter,
    private readonly now: () => number,
  ) {}

  run(
    loop: LoopRecord,
    index: number,
    lastFailure: string | undefined,
  ): Effect.Effect<LoopIterationResult, unknown> {
    const iteration: LoopIteration = {
      loopId: loop.loopId,
      index,
      status: 'running',
      checks: [],
      startedAt: this.now(),
    };
    const { now, reporter } = this;
    const saveEffect = this.saveEffect.bind(this);
    const runWorkerTurn = this.runWorkerTurn.bind(this);
    const runChecks = this.runChecks.bind(this);
    const runVerifierTurn = this.runVerifierTurn.bind(this);
    let workerText = '';
    return Effect.gen(function* () {
      yield* saveEffect(iteration);
      reporter.log(loop.loopId, 'info', 'system', `iteration ${index + 1} started`, index);
      return yield* Effect.gen(function* () {
        yield* Effect.gen(function* () {
          workerText = yield* runWorkerTurn(loop, iteration, lastFailure);
          const checksPassed = yield* driverCall((signal) => runChecks(loop, iteration, signal));
          let verifierPassed = true;
          if (checksPassed && loop.spec.verifier) {
            const verdict = yield* runVerifierTurn(loop, iteration, workerText);
            iteration.verdict = verdict;
            verifierPassed = verdict.passed;
          }
          iteration.status = checksPassed && verifierPassed ? 'passed' : 'failed';
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              iteration.status = 'failed';
              iteration.error = extractErrorMessage(error, false) ?? 'iteration failed';
              reporter.log(loop.loopId, 'error', 'system', iteration.error, index);
            }),
          ),
        );
        return { iteration, workerText, failureFeedback: describeLoopFailure(iteration) };
      }).pipe(
        Effect.onExit(() =>
          Effect.sync(() => {
            iteration.endedAt = now();
          }).pipe(Effect.andThen(saveEffect(iteration))),
        ),
      );
    });
  }

  private runWorkerTurn(
    loop: LoopRecord,
    iteration: LoopIteration,
    lastFailure: string | undefined,
  ): Effect.Effect<string, unknown> {
    const { driver, reporter } = this;
    const saveEffect = this.saveEffect.bind(this);
    return Effect.acquireUseRelease(
      driverCall((signal) =>
        driver.createSession({
          kind: loop.spec.kind,
          cwd: loop.spec.cwd,
          model: loop.spec.model,
          title: loop.spec.name ?? 'Loop worker',
          automation: { kind: 'loop', id: loop.loopId },
          signal,
        }),
      ),
      (sessionId) =>
        Effect.gen(function* () {
          iteration.workerSessionId = sessionId;
          yield* saveEffect(iteration);
          yield* driverCall((signal) => driver.makeUnattended(sessionId, signal));
          const prompt = buildLoopWorkerPrompt(loop.spec, iteration.index, lastFailure);
          const result = yield* driverCall((signal) =>
            driver.prompt(sessionId, prompt, {
              timeoutMs: loop.spec.turnTimeoutMs,
              signal,
            }),
          );
          reporter.log(loop.loopId, 'info', 'worker', result.text, iteration.index);
          return result.text;
        }),
      (sessionId) => driverCall(() => driver.stopSession(sessionId)),
    );
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
      await this.save(iteration);
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

  private runVerifierTurn(
    loop: LoopRecord,
    iteration: LoopIteration,
    workerText: string,
  ): Effect.Effect<LoopVerdict, unknown> {
    const verifier = nullthrow(loop.spec.verifier);
    const { driver, reporter } = this;
    const saveEffect = this.saveEffect.bind(this);
    return Effect.acquireUseRelease(
      driverCall((signal) =>
        driver.createSession({
          kind: verifier.kind ?? loop.spec.kind,
          cwd: loop.spec.cwd,
          model: verifier.model,
          title: 'Loop verifier',
          automation: { kind: 'loop', id: loop.loopId },
          signal,
        }),
      ),
      (sessionId) =>
        Effect.gen(function* () {
          iteration.verifierSessionId = sessionId;
          yield* saveEffect(iteration);
          yield* driverCall((signal) => driver.makeUnattended(sessionId, signal));
          const prompt = buildLoopVerifierPrompt(verifier.prompt, loop.spec.prompt, workerText);
          const verdict = yield* driverCall((signal) =>
            promptForStructured(driver, sessionId, prompt, LoopVerdictSchema, {
              timeoutMs: loop.spec.turnTimeoutMs,
              signal,
            }),
          );
          reporter.log(
            loop.loopId,
            verdict.passed ? 'info' : 'warn',
            'verifier',
            verdict.reason,
            iteration.index,
          );
          return verdict;
        }),
      (sessionId) => driverCall(() => driver.stopSession(sessionId)),
    );
  }

  private saveEffect(iteration: LoopIteration): Effect.Effect<void, unknown> {
    return fromPromise(() => this.store.saveIteration(iteration)).pipe(
      Effect.andThen(Effect.sync(() => this.reporter.iteration(iteration))),
    );
  }

  private async save(iteration: LoopIteration): Promise<void> {
    await this.store.saveIteration(iteration);
    this.reporter.iteration(iteration);
  }
}

function driverCall<A>(run: (signal: AbortSignal) => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause });
}

function fromPromise<A>(run: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: run, catch: (cause) => cause });
}
