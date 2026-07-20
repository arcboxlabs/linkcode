import { spawn } from 'node:child_process';
import { Data, Effect } from 'effect';
import { noop } from 'foxts/noop';
import { observeOperation } from '../observability';

export interface RunCommandOptions {
  cwd: string;
  /** Overlaid on `process.env`. */
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
/** stderr is only ever surfaced as an error summary — keep a short head, drop the rest. */
const STDERR_CAP_BYTES = 8 * 1024;

export class CommandError extends Data.TaggedError('CommandError')<{
  readonly reason: 'spawn' | 'timeout' | 'output_limit';
  readonly bin: string;
  readonly cause?: unknown;
}> {}

export const runCommand = Effect.fn('Process.runCommand')(function* (
  bin: string,
  args: readonly string[],
  options: RunCommandOptions,
) {
  return yield* observeOperation(
    Effect.callback<CommandResult, CommandError>((resume) => {
      let child: ReturnType<typeof spawnCommand>;
      try {
        child = spawnCommand(bin, args, options);
      } catch (error) {
        resume(Effect.fail(new CommandError({ reason: 'spawn', bin, cause: error })));
        return;
      }

      const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let outcome: Effect.Effect<CommandResult, CommandError> | undefined;
      let timer: NodeJS.Timeout | undefined;

      function cleanup(): void {
        if (timer) clearTimeout(timer);
        child.stdout.off('data', onStdout);
        child.stderr.off('data', onStderr);
        child.off('error', onError);
        child.off('close', onClose);
      }
      function stop(effect: Effect.Effect<CommandResult, CommandError>): void {
        if (settled || outcome !== undefined) return;
        outcome = effect;
        if (timer) clearTimeout(timer);
        child.kill('SIGKILL');
      }
      function onStdout(chunk: Buffer): void {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maxOutputBytes) {
          stop(Effect.fail(new CommandError({ reason: 'output_limit', bin })));
          return;
        }
        stdout += chunk.toString('utf8');
      }
      function onStderr(chunk: Buffer): void {
        if (stderrBytes >= STDERR_CAP_BYTES) return;
        const remaining = STDERR_CAP_BYTES - stderrBytes;
        const capped = chunk.subarray(0, remaining);
        stderr += capped.toString('utf8');
        stderrBytes += capped.byteLength;
      }
      function onError(cause: Error): void {
        if (outcome === undefined) {
          outcome = Effect.fail(new CommandError({ reason: 'spawn', bin, cause }));
        }
      }
      function onClose(code: number | null): void {
        if (settled) return;
        settled = true;
        cleanup();
        resume(outcome ?? Effect.succeed({ stdout, stderr, exitCode: code ?? -1 }));
      }

      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
      timer = setTimeout(() => {
        stop(Effect.fail(new CommandError({ reason: 'timeout', bin })));
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      return Effect.callback<void>((done) => {
        if (settled) {
          cleanup();
          done(Effect.void);
          return;
        }
        cleanup();
        child.on('error', noop);
        child.once('close', () => done(Effect.void));
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
    }),
    {
      span: 'Process.execute',
      subsystem: 'process',
      failureOutcome: (error) =>
        error instanceof CommandError && error.reason === 'timeout' ? 'timed_out' : 'failed',
    },
  );
});

function spawnCommand(bin: string, args: readonly string[], options: RunCommandOptions) {
  return spawn(bin, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
