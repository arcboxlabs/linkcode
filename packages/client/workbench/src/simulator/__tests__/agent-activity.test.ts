// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorActivityClient } from '../agent-activity';
import { useSimulatorAgentActivity } from '../agent-activity';

type Activity = Parameters<Parameters<SimulatorActivityClient['subscribeSimulatorActivity']>[0]>[0];

/** A client whose activity feed the test drives by hand. */
function fakeClient(): SimulatorActivityClient & { emit: (activity: Activity) => void } {
  const listeners = new Set<(activity: Activity) => void>();
  return {
    subscribeSimulatorActivity(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    emit(activity) {
      act(() => {
        for (const listener of listeners) listener(activity);
      });
    },
  };
}

const started = (
  udid: string | undefined,
  tool = 'sim_tap',
  at?: { x: number; y: number },
): Activity => ({ sessionId: 's1', udid, tool, phase: 'started', ...at }) as Activity;
const settled = (udid: string | undefined, tool = 'sim_tap'): Activity =>
  ({ sessionId: 's1', udid, tool, phase: 'settled' }) as Activity;

describe('useSimulatorAgentActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('lights while a tool runs and clears after the linger', () => {
    const client = fakeClient();
    const { result } = renderHook(() => useSimulatorAgentActivity(client, 'U-1'));
    expect(result.current.active).toBe(false);

    client.emit(started('U-1'));
    expect(result.current.active).toBe(true);

    client.emit(settled('U-1'));
    // Still lit: the linger is what keeps a burst of taps from strobing the badge.
    expect(result.current.active).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.active).toBe(false);
  });

  it('stays lit until the last overlapping tool settles', () => {
    const client = fakeClient();
    const { result } = renderHook(() => useSimulatorAgentActivity(client, 'U-1'));

    client.emit(started('U-1', 'sim_tap'));
    client.emit(started('U-1', 'sim_screenshot'));
    client.emit(settled('U-1', 'sim_tap'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // One tool is still running, so the first settle must not clear the badge.
    expect(result.current.active).toBe(true);

    client.emit(settled('U-1', 'sim_screenshot'));
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.active).toBe(false);
  });

  it('ignores activity for other devices and device-less tools', () => {
    const client = fakeClient();
    const { result } = renderHook(() => useSimulatorAgentActivity(client, 'U-1'));

    client.emit(started('U-2'));
    client.emit(started(undefined, 'sim_list_devices'));
    expect(result.current.active).toBe(false);
  });

  it('tracks the point a pointer tool acted on, and expires it', () => {
    const client = fakeClient();
    const { result } = renderHook(() => useSimulatorAgentActivity(client, 'U-1'));
    expect(result.current.point).toBeNull();

    client.emit(started('U-1', 'sim_tap', { x: 0.25, y: 0.75 }));
    expect(result.current.point).toEqual({ x: 0.25, y: 0.75 });

    // A pointless tool between two taps must not blink the pointer away — only time clears it.
    client.emit(started('U-1', 'sim_screenshot'));
    expect(result.current.point).toEqual({ x: 0.25, y: 0.75 });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.point).toBeNull();
  });
});
