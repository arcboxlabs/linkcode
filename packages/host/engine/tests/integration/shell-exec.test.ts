import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';
import { runShellCheck } from '../../src/automation/shell-exec';

describe('runShellCheck', () => {
  it('reports exit 0 and captured output for a passing command', async () => {
    const result = await Effect.runPromise(runShellCheck('echo hello', { cwd: tmpdir() }));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.outputTail).toContain('hello');
  });

  it('reports the non-zero exit code of a failing command', async () => {
    const result = await Effect.runPromise(
      runShellCheck('echo boom >&2; exit 3', { cwd: tmpdir() }),
    );
    expect(result.exitCode).toBe(3);
    expect(result.outputTail).toContain('boom');
  });

  it('caps captured output at the tail', async () => {
    const result = await Effect.runPromise(
      runShellCheck('for i in $(seq 1 5000); do echo line$i; done', {
        cwd: tmpdir(),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.outputTail.length).toBeLessThanOrEqual(4096);
    // The tail, not the head, is retained.
    expect(result.outputTail).toContain('line5000');
    expect(result.outputTail).not.toContain('line1\n');
  });

  it('stops a command before returning its timeout result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shell-check-'));
    const pidFile = join(directory, 'pid');
    try {
      const result = await Effect.runPromise(
        runShellCheck(`echo $$ > "${pidFile}"; while :; do :; done`, {
          cwd: tmpdir(),
          timeoutMs: 100,
        }),
      );
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(isProcessRunning(await readPid(pidFile))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops a command before interruption completes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shell-check-'));
    const pidFile = join(directory, 'pid');
    try {
      const fiber = Effect.runFork(
        runShellCheck(`echo $$ > "${pidFile}"; while :; do :; done`, { cwd: tmpdir() }),
      );
      const pid = await readPid(pidFile);

      await Effect.runPromise(Fiber.interrupt(fiber));

      expect(isProcessRunning(pid)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function readPid(pidFile: string): Promise<number> {
  try {
    return Number.parseInt(await readFile(pidFile, 'utf8'), 10);
  } catch {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 5);
    });
    return readPid(pidFile);
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
