import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, Listener[]>(),
  autoUpdater: {
    logger: null,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    quitAndInstall: vi.fn(),
  },
  log: {
    transports: { file: { level: 'info' } },
    error: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({ default: mocks.log }));
vi.mock('electron-updater', () => ({ autoUpdater: mocks.autoUpdater }));
vi.mock('../constants', () => ({ CHANNEL: 'release' }));

function emit(event: string, ...args: unknown[]): void {
  for (const listener of mocks.listeners.get(event) ?? []) listener(...args);
}

describe('desktop updater', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.listeners.clear();
    mocks.autoUpdater.on.mockImplementation((event: string, listener: Listener) => {
      const listeners = mocks.listeners.get(event) ?? [];
      listeners.push(listener);
      mocks.listeners.set(event, listeners);
      return mocks.autoUpdater;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles checks when the updater is inactive for the current package format', async () => {
    const updater = await import('../updater');

    updater.checkForUpdates();
    expect(updater.getUpdaterState()).toEqual({
      status: 'checking',
      version: null,
      progress: null,
    });

    await mocks.autoUpdater.checkForUpdates.mock.results[0]?.value;
    expect(updater.getUpdaterState()).toEqual({
      status: 'not-available',
      version: null,
      progress: null,
    });
  });

  it('polls every four hours and preserves a downloaded update until installation', async () => {
    const updater = await import('../updater');
    const states: unknown[] = [];
    updater.onUpdaterState((state) => states.push(state));

    updater.initAutoUpdates();
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(() => updater.installUpdate()).toThrow('No downloaded update to install');

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);

    emit('update-available', { version: '0.13.0' });
    emit('download-progress', { percent: 50 });
    expect(updater.getUpdaterState()).toEqual({
      status: 'downloading',
      version: '0.13.0',
      progress: 50,
    });
    emit('update-downloaded', { version: '0.13.0' });

    expect(updater.getUpdaterState()).toEqual({
      status: 'downloaded',
      version: '0.13.0',
      progress: null,
    });
    expect(states).toContainEqual({ status: 'available', version: '0.13.0', progress: null });
    expect(states).toContainEqual({
      status: 'downloading',
      version: '0.13.0',
      progress: 50,
    });

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);

    updater.installUpdate();
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
