import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../automation/ring-buffer';
import { runShellCheck } from '../automation/shell-exec';

describe('runShellCheck', () => {
  it('reports exit 0 and captured output for a passing command', async () => {
    const result = await runShellCheck('echo hello', { cwd: tmpdir() });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.outputTail).toContain('hello');
  });

  it('reports the non-zero exit code of a failing command', async () => {
    const result = await runShellCheck('echo boom >&2; exit 3', { cwd: tmpdir() });
    expect(result.exitCode).toBe(3);
    expect(result.outputTail).toContain('boom');
  });

  it('caps captured output at the tail', async () => {
    const result = await runShellCheck('for i in $(seq 1 5000); do echo line$i; done', {
      cwd: tmpdir(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.outputTail.length).toBeLessThanOrEqual(4096);
    // The tail, not the head, is retained.
    expect(result.outputTail).toContain('line5000');
    expect(result.outputTail).not.toContain('line1\n');
  });

  it('kills a command that overruns its timeout', async () => {
    const result = await runShellCheck('sleep 5', { cwd: tmpdir(), timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('kills a command when aborted', async () => {
    const controller = new AbortController();
    const pending = runShellCheck('sleep 5', { cwd: tmpdir(), signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('RingBuffer', () => {
  it('drops the oldest entries past capacity and snapshots in order', () => {
    const buffer = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i += 1) buffer.push(i);
    expect(buffer.size).toBe(3);
    expect(buffer.snapshot()).toEqual([3, 4, 5]);
  });
});
