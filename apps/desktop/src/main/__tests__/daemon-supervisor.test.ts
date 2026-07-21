import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    on: vi.fn(),
    quit: vi.fn(),
    // constants.ts resolves the profile at import time (supervisor → constants).
    commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
  },
  fork: vi.fn(),
  getSettings: vi.fn(),
  watchRuntime: vi.fn(),
  unwatchRuntime: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  /** When true, pretend `out/daemon/instrument.mjs` is on disk (Sentry preload path). */
  instrumentPresent: false,
  existsSync: vi.fn((path: unknown) => {
    const s = String(path);
    if (s.endsWith('instrument.mjs')) return mocks.instrumentPresent;
    // Sidecar absence is fine in these tests (supervisor only warns).
    if (s.includes('linkcode-pty')) return false;
    return false;
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: (path: unknown) => mocks.existsSync(path),
}));

vi.mock('electron', () => ({
  app: mocks.app,
  utilityProcess: { fork: mocks.fork },
}));

vi.mock('electron-log', () => ({ default: mocks.log }));

vi.mock('../daemon-discovery', () => ({
  watchDaemonRuntime: mocks.watchRuntime,
}));

vi.mock('../settings', () => ({
  getSettings: mocks.getSettings,
}));

interface FakeUtilityProcess {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  on(event: 'exit', listener: (code: number) => void): FakeUtilityProcess;
  once(event: 'exit', listener: (code: number) => void): FakeUtilityProcess;
  emitExit(code: number): void;
}

let daemonUrl: string | null;
let runtimeChanged: (() => void) | null;
let children: FakeUtilityProcess[];

function fakeUtilityProcess(): FakeUtilityProcess {
  const exitListeners: Array<(code: number) => void> = [];
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    on(_event, listener) {
      exitListeners.push(listener);
      return this;
    },
    once(event, listener) {
      return this.on(event, listener);
    },
    emitExit(code) {
      for (const listener of exitListeners) listener(code);
    },
  };
}

function beforeQuit(): (event: { preventDefault: () => void }) => void {
  const registered = mocks.app.on.mock.calls.find(([event]) => event === 'before-quit');
  if (!registered) throw new Error('supervisor did not register a before-quit handler');
  return registered[1] as (event: { preventDefault: () => void }) => void;
}

async function startSupervisor(): Promise<typeof import('../daemon-supervisor')> {
  const supervisor = await import('../daemon-supervisor');
  supervisor.startDaemonSupervisor();
  return supervisor;
}

describe('daemon supervisor recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'));
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/tmp/linkcode-resources',
    });

    daemonUrl = null;
    runtimeChanged = null;
    children = [];
    mocks.instrumentPresent = false;
    mocks.getSettings.mockImplementation(() => ({ daemonUrl }));
    mocks.watchRuntime.mockImplementation((listener: () => void) => {
      runtimeChanged = listener;
      return mocks.unwatchRuntime;
    });
    mocks.fork.mockImplementation(() => {
      const child = fakeUtilityProcess();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-arms an external-daemon stand-down when runtime.json changes', async () => {
    await startSupervisor();
    expect(children).toHaveLength(1);

    children[0].emitExit(3);
    expect(children).toHaveLength(1);

    runtimeChanged!();
    expect(children).toHaveLength(2);
  });

  it('keeps crash-loop give-up blocked until an explicit retry resets its budget', async () => {
    const supervisor = await startSupervisor();

    for (let exit = 0; exit < 5; exit += 1) {
      children[exit].emitExit(1);
      if (exit < 4) vi.advanceTimersByTime(1000);
    }
    expect(children).toHaveLength(5);

    runtimeChanged!();
    expect(children).toHaveLength(5);

    supervisor.retryDaemonSupervisor();
    expect(children).toHaveLength(6);

    children[5].emitExit(1);
    vi.advanceTimersByTime(1000);
    expect(children).toHaveLength(7);
  });

  it('rechecks managed state before a scheduled respawn', async () => {
    await startSupervisor();
    children[0].emitExit(1);

    daemonUrl = 'http://127.0.0.1:3000';
    vi.advanceTimersByTime(1000);

    expect(children).toHaveLength(1);
  });

  it('holds the quit until the SIGTERMed daemon has exited', async () => {
    await startSupervisor();
    const preventDefault = vi.fn();

    beforeQuit()({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(mocks.app.quit).not.toHaveBeenCalled();

    children[0].emitExit(0);
    expect(mocks.app.quit).toHaveBeenCalledTimes(1);

    // The re-quit must run to completion — no second drain, no respawn.
    beforeQuit()({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(children).toHaveLength(1);
  });

  it('quits anyway when the daemon overruns its drain grace', async () => {
    await startSupervisor();
    const preventDefault = vi.fn();

    beforeQuit()({ preventDefault });
    vi.advanceTimersByTime(5000);

    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    expect(mocks.log.warn).toHaveBeenCalledWith(expect.stringContaining('did not drain in time'));
  });

  it('preloads instrument.mjs when present and leaves DSN unset without a signed-build inject', async () => {
    mocks.instrumentPresent = true;
    await startSupervisor();

    expect(mocks.fork).toHaveBeenCalledTimes(1);
    const forkArgs = mocks.fork.mock.calls[0] as [
      string,
      string[],
      { env?: Record<string, string | undefined>; execArgv?: string[] },
    ];
    const options = forkArgs[2];
    expect(options.execArgv?.[0]).toBe('--import');
    expect(options.execArgv?.[1]?.endsWith('instrument.mjs')).toBe(true);
    // MAIN_VITE_SENTRY_DSN is empty in unit tests (no signed-build inject).
    expect(options.env?.LINKCODE_SENTRY_DSN).toBeUndefined();
  });

  it('skips --import when instrument.mjs is missing', async () => {
    mocks.instrumentPresent = false;
    await startSupervisor();

    const forkArgs = mocks.fork.mock.calls[0] as [string, string[], { execArgv?: string[] }];
    expect(forkArgs[2].execArgv).toEqual([]);
  });
});
