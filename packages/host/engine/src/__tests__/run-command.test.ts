import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Fiber } from 'effect';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../process/run-command';

describe('runCommand', () => {
  it('captures output and preserves non-zero exit codes', async () => {
    const result = await Effect.runPromise(
      runCommand(process.execPath, ['-e', 'process.stdout.write("out"); process.exit(7)'], {
        cwd: process.cwd(),
      }),
    );

    expect(result).toEqual({ stdout: 'out', stderr: '', exitCode: 7 });
  });

  it('stops the process before reporting a typed timeout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'run-command-'));
    const pidFile = join(directory, 'pid');
    try {
      await expect(
        Effect.runPromise(
          runCommand(process.execPath, ['-e', writePidAndWait(pidFile)], {
            cwd: process.cwd(),
            timeoutMs: 50,
          }),
        ),
      ).rejects.toMatchObject({ _tag: 'CommandError', reason: 'timeout' });

      expect(isProcessRunning(await readPid(pidFile))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stops the process before interruption completes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'run-command-'));
    const pidFile = join(directory, 'pid');
    try {
      const fiber = Effect.runFork(
        runCommand(process.execPath, ['-e', writePidAndWait(pidFile)], {
          cwd: process.cwd(),
          timeoutMs: 5000,
        }),
      );
      const pid = await readPid(pidFile);

      await Effect.runPromise(Fiber.interrupt(fiber));

      expect(isProcessRunning(pid)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails when stdout exceeds the configured cap', async () => {
    await expect(
      Effect.runPromise(
        runCommand(process.execPath, ['-e', 'process.stdout.write("overflow")'], {
          cwd: process.cwd(),
          maxOutputBytes: 4,
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'CommandError', reason: 'output_limit' });
  });
});

function writePidAndWait(pidFile: string): string {
  return `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
}

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
