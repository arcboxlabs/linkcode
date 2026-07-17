import { spawn } from 'node:child_process';

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

/** Spawn a CLI and collect its output (`shell: false` — arguments are never shell-interpreted).
 * A non-zero exit **resolves** (callers branch on the exit code); only spawn failures (ENOENT),
 * timeouts, and output overruns reject. */
export function runCommand(
  bin: string,
  args: readonly string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > maxOutputBytes) {
        child.kill('SIGKILL');
        settle(() => reject(new Error(`${bin} produced more than ${maxOutputBytes} bytes`)));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP_BYTES) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => settle(() => reject(err)));
    child.on('close', (code) =>
      settle(() => {
        if (timedOut) {
          reject(new Error(`${bin} ${args[0] ?? ''} timed out`));
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      }),
    );
  });
}
