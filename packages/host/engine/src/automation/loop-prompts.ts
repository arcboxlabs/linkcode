import type { LoopIteration, LoopSpec } from '@linkcode/schema';

const FEEDBACK_MAX_CHARS = 2000;

export function describeLoopFailure(iteration: LoopIteration): string {
  if (iteration.error) return iteration.error;
  if (iteration.verdict && !iteration.verdict.passed) {
    return `Verifier rejected the result: ${iteration.verdict.reason}`;
  }
  const failed = iteration.checks.find((check) => check.exitCode !== 0);
  if (failed) {
    return `Check \`${failed.command}\` failed (exit ${failed.exitCode}):\n${truncate(failed.outputTail)}`;
  }
  return 'The previous attempt did not pass verification.';
}

export function buildLoopWorkerPrompt(
  spec: LoopSpec,
  index: number,
  lastFailure: string | undefined,
): string {
  if (index === 0 || !lastFailure) return spec.prompt;
  return `${spec.prompt}\n\nThe previous attempt did not pass verification:\n${lastFailure}\n\nAddress the problem and try again.`;
}

export function buildLoopVerifierPrompt(
  verifierPrompt: string,
  workerGoal: string,
  workerText: string,
): string {
  return [
    verifierPrompt,
    `\nThe worker was asked to: ${workerGoal}`,
    workerText.trim() ? `\nThe worker reported:\n${truncate(workerText)}` : '',
    '\nInspect the working directory as needed, then reply with ONLY a JSON object: {"passed": boolean, "reason": string}.',
  ].join('\n');
}

function truncate(text: string): string {
  return text.length > FEEDBACK_MAX_CHARS ? text.slice(0, FEEDBACK_MAX_CHARS) : text;
}
