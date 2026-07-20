import { spawn } from 'node:child_process';
import { Effect } from 'effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';

/** Tail of combined stdout+stderr kept per check (matches LoopCheckResult.outputTail). */
const OUTPUT_TAIL_MAX = 4096;
/** SIGTERM → wait → SIGKILL grace for a check that overran its timeout or was interrupted. */
const KILL_GRACE_MS = 5000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** GNU `timeout`'s convention: a command killed for overrunning exits 124. */
const TIMEOUT_EXIT_CODE = 124;

export interface ShellCheckResult {
  /** Process exit code; a timeout kill surfaces as a non-zero code with `timedOut` set. */
  exitCode: number;
  timedOut: boolean;
  /** Tail of combined stdout+stderr, capped at ~4 KB. */
  outputTail: string;
}

export interface ShellCheckOptions {
  cwd: string;
  timeoutMs?: number;
}

/**
 * Run one verify-check with Node's platform shell (`COMSPEC` on Windows, `/bin/sh` elsewhere) in
 * `cwd`, capturing the tail of its combined output. Never rejects — a spawn error or non-zero exit
 * is a normal check result.
 */
export function runShellCheck(
  command: string,
  opts: ShellCheckOptions,
): Effect.Effect<ShellCheckResult> {
  return Effect.callback<ShellCheckResult>((resume) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      env: process.env,
      shell: true,
      windowsHide: true,
    });

    let output = '';
    let timedOut = false;
    let settled = false;
    let terminating = false;
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
      if (terminating) return;
      terminating = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      escalate();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref();

    const cleanup = (): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    const onError = (err: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      append(`\n${extractErrorMessage(err) ?? 'failed to spawn'}`);
      resume(Effect.succeed({ exitCode: 127, timedOut, outputTail: output }));
    };
    const onClose = (code: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const exitCode = code ?? (timedOut ? TIMEOUT_EXIT_CODE : 1);
      resume(Effect.succeed({ exitCode, timedOut, outputTail: output }));
    };
    child.on('error', onError);
    child.on('close', onClose);

    return Effect.callback<void>((done) => {
      if (settled) {
        cleanup();
        done(Effect.void);
        return;
      }
      clearTimeout(timer);
      child.off('error', onError);
      child.off('close', onClose);
      child.on('error', noop);
      child.once('close', () => {
        cleanup();
        done(Effect.void);
      });
      if (child.exitCode === null && child.signalCode === null) escalate();
    });
  });
}
