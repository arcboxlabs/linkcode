import { spawn } from 'node:child_process';
import { extractErrorMessage } from 'foxts/extract-error-message';

/** Tail of combined stdout+stderr kept per check (matches LoopCheckResult.outputTail). */
const OUTPUT_TAIL_MAX = 4096;
/** SIGTERM → wait → SIGKILL grace for a check that overran its timeout or was aborted. */
const KILL_GRACE_MS = 5000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** GNU `timeout`'s convention: a command killed for overrunning exits 124. */
const TIMEOUT_EXIT_CODE = 124;

export interface ShellCheckResult {
  /** Process exit code; a timeout/abort kill surfaces as a non-zero code with `timedOut` set. */
  exitCode: number;
  timedOut: boolean;
  /** Tail of combined stdout+stderr, capped at ~4 KB. */
  outputTail: string;
}

export interface ShellCheckOptions {
  cwd: string;
  timeoutMs?: number;
  /** Aborting kills the process (SIGTERM → SIGKILL) and settles with a non-zero code. */
  signal?: AbortSignal;
}

/**
 * Run one verify-check with Node's platform shell (`COMSPEC` on Windows, `/bin/sh` elsewhere) in
 * `cwd`, capturing the tail of its combined output. Never rejects — a spawn error or non-zero exit
 * is a normal check result.
 */
export function runShellCheck(command: string, opts: ShellCheckOptions): Promise<ShellCheckResult> {
  return new Promise<ShellCheckResult>((resolve) => {
    const child = spawn(command, { cwd: opts.cwd, env: process.env, shell: true });

    let output = '';
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const append = (chunk: string): void => {
      output += chunk;
      if (output.length > OUTPUT_TAIL_MAX) output = output.slice(-OUTPUT_TAIL_MAX);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const escalate = (): void => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      escalate();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref();

    const onAbort = (): void => {
      timedOut = true;
      escalate();
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (err: unknown) => {
      cleanup();
      append(`\n${extractErrorMessage(err) ?? 'failed to spawn'}`);
      resolve({ exitCode: 127, timedOut, outputTail: output });
    });
    child.on('close', (code: number | null) => {
      cleanup();
      const exitCode = code ?? (timedOut ? TIMEOUT_EXIT_CODE : 1);
      resolve({ exitCode, timedOut, outputTail: output });
    });
  });
}
