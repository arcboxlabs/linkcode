import type { LoopIteration, LoopRecord, LoopVerdict, SessionId } from '@linkcode/schema';
import { LoopVerdictSchema } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
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

  async run(
    loop: LoopRecord,
    index: number,
    lastFailure: string | undefined,
    signal: AbortSignal,
  ): Promise<LoopIterationResult> {
    const iteration: LoopIteration = {
      loopId: loop.loopId,
      index,
      status: 'running',
      checks: [],
      startedAt: this.now(),
    };
    await this.save(iteration);
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
    } catch (error) {
      iteration.status = 'failed';
      iteration.error = extractErrorMessage(error, false) ?? 'iteration failed';
      this.reporter.log(loop.loopId, 'error', 'system', iteration.error, index);
    }
    iteration.endedAt = this.now();
    await this.save(iteration);
    return { iteration, workerText, failureFeedback: describeLoopFailure(iteration) };
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
    await this.save(iteration);
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
    await this.save(iteration);
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

  private async save(iteration: LoopIteration): Promise<void> {
    await this.store.saveIteration(iteration);
    this.reporter.iteration(iteration);
  }
}
