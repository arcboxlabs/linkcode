import { asyncNoop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { BackgroundRefreshScheduler } from '../lifecycle';
import {
  registerBackgroundRefresh,
  subscribeToEmergencyRefresh,
  subscribeToForegroundRefresh,
} from '../lifecycle';

class StateSource {
  listener: ((state: string) => void) | null = null;

  constructor(public currentState: string) {}

  addEventListener(_type: 'change', listener: (state: string) => void) {
    this.listener = listener;
    return {
      remove: () => {
        this.listener = null;
      },
    };
  }

  emit(state: string): void {
    this.currentState = state;
    this.listener?.(state);
  }
}

describe('mobile configuration lifecycle', () => {
  it('refreshes only when the app returns to the foreground', () => {
    const source = new StateSource('active');
    const refresh = vi.fn();
    const unsubscribe = subscribeToForegroundRefresh(source, refresh);

    source.emit('inactive');
    source.emit('background');
    source.emit('active');
    source.emit('active');
    expect(refresh).toHaveBeenCalledOnce();

    unsubscribe();
    source.emit('background');
    source.emit('active');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('registers supported background refresh once', async () => {
    const scheduler = makeScheduler(true, false);
    await expect(registerBackgroundRefresh(true, scheduler)).resolves.toBe('registered');
    expect(scheduler.register).toHaveBeenCalledOnce();

    const existing = makeScheduler(true, true);
    await expect(registerBackgroundRefresh(true, existing)).resolves.toBe('registered');
    expect(existing.register).not.toHaveBeenCalled();
  });

  it('reports disabled and unsupported capabilities without registering', async () => {
    const disabled = makeScheduler(true, false);
    await expect(registerBackgroundRefresh(false, disabled)).resolves.toBe('disabled');
    expect(disabled.isAvailable).not.toHaveBeenCalled();

    const unsupported = makeScheduler(false, false);
    await expect(registerBackgroundRefresh(true, unsupported)).resolves.toBe('unsupported');
    expect(unsupported.register).not.toHaveBeenCalled();
  });

  it('schedules emergency refresh cadence and retries failures', async () => {
    vi.useFakeTimers();
    const source = new StateSource('active');
    const refresh = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const unsubscribe = subscribeToEmergencyRefresh(source, refresh);

    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(refresh).toHaveBeenCalledTimes(3);

    unsubscribe();
    vi.useRealTimers();
  });

  it('pauses, resumes, and ignores stale emergency refresh completion after cleanup', async () => {
    vi.useFakeTimers();
    const source = new StateSource('background');
    let finishRefresh: ((success: boolean) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const unsubscribe = subscribeToEmergencyRefresh(source, refresh);

    await vi.advanceTimersByTimeAsync(10 * 1000);
    expect(refresh).not.toHaveBeenCalled();
    source.emit('active');
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledOnce();
    source.emit('background');
    finishRefresh?.(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(refresh).toHaveBeenCalledOnce();

    source.emit('active');
    unsubscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledOnce();
    expect(source.listener).toBeNull();
    vi.useRealTimers();
  });
});

function makeScheduler(available: boolean, registered: boolean) {
  return {
    isAvailable: vi.fn(() => Promise.resolve(available)),
    isRegistered: vi.fn(() => Promise.resolve(registered)),
    register: vi.fn(asyncNoop),
  } satisfies BackgroundRefreshScheduler;
}
