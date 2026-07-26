// @vitest-environment jsdom

import type { SessionId } from '@linkcode/schema';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatorActivityClient } from '../agent-activity';
import { useSimulatorAutoReveal } from '../auto-reveal';
import { suppressSimulatorAutoReveal, useSimulatorPanelStore } from '../panel-store';

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

const SESSION = 's1' as SessionId;
const OTHER_SESSION = 's2' as SessionId;

function started(sessionId: SessionId, udid: string | undefined): Activity {
  return { sessionId, udid, tool: 'sim_boot', phase: 'started' };
}

describe('useSimulatorAutoReveal', () => {
  beforeEach(() => {
    useSimulatorPanelStore.setState({ selectedUdid: null, autoRevealSuppressed: {} });
  });
  afterEach(cleanup);

  it('reveals once and points the panel at the device', () => {
    const client = fakeClient();
    const onReveal = vi.fn();
    renderHook(() => useSimulatorAutoReveal(client, SESSION, onReveal));

    client.emit(started(SESSION, 'U-1'));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(useSimulatorPanelStore.getState().selectedUdid).toBe('U-1');

    // The thread spent its one reveal: from here the panel is the user's, however busy the agent
    // gets — including on a device they did not select.
    client.emit(started(SESSION, 'U-2'));
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(useSimulatorPanelStore.getState().selectedUdid).toBe('U-1');
  });

  it('ignores other threads and device-less tools', () => {
    const client = fakeClient();
    const onReveal = vi.fn();
    renderHook(() => useSimulatorAutoReveal(client, SESSION, onReveal));

    client.emit(started(OTHER_SESSION, 'U-1'));
    client.emit(started(SESSION, undefined));
    expect(onReveal).not.toHaveBeenCalled();
    expect(useSimulatorPanelStore.getState().selectedUdid).toBeNull();
  });

  it('stays out of the way once the user closes the section', () => {
    const client = fakeClient();
    const onReveal = vi.fn();
    renderHook(() => useSimulatorAutoReveal(client, SESSION, onReveal));

    suppressSimulatorAutoReveal(SESSION);
    client.emit(started(SESSION, 'U-1'));
    expect(onReveal).not.toHaveBeenCalled();
  });
});
