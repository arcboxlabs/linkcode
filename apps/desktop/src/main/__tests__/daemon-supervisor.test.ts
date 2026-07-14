import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    on: vi.fn(),
    // constants.ts resolves the profile at import time (supervisor → constants).
    commandLine: { getSwitchValue: () => '' },
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
  emitExit(code: number): void;
}

let daemonUrl: string | null;
let runtimeChanged: (() => void) | null;
let children: FakeUtilityProcess[];

function fakeUtilityProcess(): FakeUtilityProcess {
  let exitListener: ((code: number) => void) | null = null;
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    on(_event, listener) {
      exitListener = listener;
      return this;
    },
    emitExit(code) {
      exitListener?.(code);
    },
  };
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
});
