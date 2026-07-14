import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpencodeHistoryServer } from '../native/opencode/history-server';

class FakeStdio extends EventEmitter {
  destroy = vi.fn();
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new FakeStdio();
  readonly stderr = new FakeStdio();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];
  unref = vi.fn();

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  }

  emitReady(port: number): void {
    this.stdout.emit(
      'data',
      Buffer.from(`opencode server listening on http://127.0.0.1:${port}\n`),
    );
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

const NEUTRAL_CWD = join(tmpdir(), 'linkcode-test-opencode-neutral');

function makeManager(options: { idleMs?: number; readyTimeoutMs?: number } = {}): {
  manager: OpencodeHistoryServer;
  spawned: FakeChildProcess[];
  spawnArgs: Array<{ port: number; cwd: string }>;
} {
  const spawned: FakeChildProcess[] = [];
  const spawnArgs: Array<{ port: number; cwd: string }> = [];
  let nextPort = 40001;
  const manager = new OpencodeHistoryServer({
    spawnServer(args) {
      spawnArgs.push(args);
      const proc = new FakeChildProcess();
      spawned.push(proc);
      return proc;
    },
    allocatePort: () => Promise.resolve(nextPort++),
    neutralCwd: NEUTRAL_CWD,
    idleMs: options.idleMs ?? 1000,
    readyTimeoutMs: options.readyTimeoutMs ?? 5000,
    shutdownGraceMs: 200,
  });
  return { manager, spawned, spawnArgs };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OpencodeHistoryServer', () => {
  it('spawns once, reports readiness, and shares the server across concurrent calls', async () => {
    const { manager, spawned, spawnArgs } = makeManager();
    const first = manager.withServer((url) => Promise.resolve(`a:${url}`));
    const second = manager.withServer((url) => Promise.resolve(`b:${url}`));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].emitReady(40001);
    expect(await first).toBe('a:http://127.0.0.1:40001');
    expect(await second).toBe('b:http://127.0.0.1:40001');
    expect(spawnArgs).toEqual([{ port: 40001, cwd: NEUTRAL_CWD }]);
    // Pipes detached + child unref'd after readiness so an idle server never holds the loop open.
    expect(spawned[0].stdout.destroy).toHaveBeenCalled();
    expect(spawned[0].unref).toHaveBeenCalled();
    spawned[0].emitExit(0);
  });

  it('reaps the server after the idle period and respawns on the next call', async () => {
    const { manager, spawned } = makeManager({ idleMs: 1000 });
    const call = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].emitReady(40001);
    await call;
    await vi.advanceTimersByTimeAsync(1000);
    expect(spawned[0].signals).toContain('SIGTERM');
    spawned[0].emitExit(null, 'SIGTERM');

    const again = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(2));
    spawned[1].emitReady(40002);
    expect(await again).toBe('http://127.0.0.1:40002');
    spawned[1].emitExit(0);
  });

  it('does not reap while a call is still in flight', async () => {
    const { manager, spawned } = makeManager({ idleMs: 1000 });
    let releaseCall: (() => void) | undefined;
    const inFlight = manager.withServer(
      (url) =>
        new Promise<string>((resolve) => {
          releaseCall = () => resolve(url);
        }),
    );
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].emitReady(40001);
    await vi.advanceTimersByTimeAsync(5000);
    expect(spawned[0].signals).toHaveLength(0);
    releaseCall?.();
    await inFlight;
    spawned[0].emitExit(0);
  });

  it('respawns after a crash instead of reusing the dead generation', async () => {
    const { manager, spawned } = makeManager();
    const first = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].emitReady(40001);
    await first;
    spawned[0].emitExit(1);

    const second = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(2));
    spawned[1].emitReady(40002);
    expect(await second).toBe('http://127.0.0.1:40002');
    spawned[1].emitExit(0);
  });

  it('fails the call with captured output when the server dies during startup, then retries fresh', async () => {
    const { manager, spawned } = makeManager();
    const failing = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].stderr.emit('data', Buffer.from('bad config\n'));
    spawned[0].emitExit(1);
    await expect(failing).rejects.toThrow(/exited during startup \(code 1\)[\s\S]*bad config/);

    const retry = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(2));
    spawned[1].emitReady(40002);
    expect(await retry).toBe('http://127.0.0.1:40002');
    spawned[1].emitExit(0);
  });

  it('times out a server that never reports readiness and SIGKILLs it', async () => {
    const { manager, spawned } = makeManager({ readyTimeoutMs: 5000 });
    const call = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    // Attached before the clock advances: the rejection fires mid-advance, and an
    // unhandled-at-that-instant rejection fails the whole test file.
    const rejection = expect(call).rejects.toThrow(/startup timed out after 5000ms/);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(spawned[0].signals).toContain('SIGKILL');
    spawned[0].emitExit(null, 'SIGKILL');
  });

  it('dispose escalates SIGTERM to SIGKILL when the server ignores the grace period', async () => {
    const { manager, spawned } = makeManager();
    const call = manager.withServer((url) => Promise.resolve(url));
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].emitReady(40001);
    await call;

    const disposed = manager.dispose();
    expect(spawned[0].signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(200);
    expect(spawned[0].signals).toEqual(['SIGTERM', 'SIGKILL']);
    spawned[0].emitExit(null, 'SIGKILL');
    await disposed;
  });
});
