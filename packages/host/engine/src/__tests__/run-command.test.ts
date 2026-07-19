import { Effect } from 'effect';
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

  it('fails with a typed timeout', async () => {
    await expect(
      Effect.runPromise(
        runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          cwd: process.cwd(),
          timeoutMs: 10,
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'CommandError', reason: 'timeout' });
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
