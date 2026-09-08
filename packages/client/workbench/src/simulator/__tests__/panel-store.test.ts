import { MAX_SIMULATORS_PER_SESSION } from '@linkcode/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { selectDeviceTabs, useSimulatorPanelStore } from '../panel-store';

const A = 'thread-a';
const B = 'thread-b';

function tabsOf(key: string): { udids: readonly string[]; activeUdid: string | null } {
  return selectDeviceTabs(useSimulatorPanelStore.getState(), key);
}
function open(key: string, udid: string): void {
  return useSimulatorPanelStore.getState().openDevice(key, udid);
}

describe('simulator device tabs', () => {
  beforeEach(() => {
    useSimulatorPanelStore.setState({ tabsBySession: {}, autoRevealSuppressed: {} });
  });

  it('opens devices in order and brings an already-open one forward instead of duplicating it', () => {
    open(A, 'U-1');
    open(A, 'U-2');
    expect(tabsOf(A)).toEqual({ udids: ['U-1', 'U-2'], activeUdid: 'U-2' });

    open(A, 'U-1');
    expect(tabsOf(A)).toEqual({ udids: ['U-1', 'U-2'], activeUdid: 'U-1' });
  });

  it('stops at the per-thread cap the host enforces', () => {
    for (let i = 0; i < MAX_SIMULATORS_PER_SESSION; i += 1) open(A, `U-${i}`);
    expect(tabsOf(A).udids).toHaveLength(MAX_SIMULATORS_PER_SESSION);

    // The engine would refuse this claim, so the panel must not open a tab that can never stream.
    open(A, 'U-over');
    expect(tabsOf(A).udids).toHaveLength(MAX_SIMULATORS_PER_SESSION);
    expect(tabsOf(A).activeUdid).toBe(`U-${MAX_SIMULATORS_PER_SESSION - 1}`);
  });

  it('counts the cap per thread, not globally', () => {
    for (let i = 0; i < MAX_SIMULATORS_PER_SESSION; i += 1) open(A, `U-${i}`);
    open(B, 'U-other');
    expect(tabsOf(B).udids).toEqual(['U-other']);
  });

  it('falls the active tab back to a neighbour when the front one closes', () => {
    open(A, 'U-1');
    open(A, 'U-2');
    open(A, 'U-3');
    useSimulatorPanelStore.getState().selectDevice(A, 'U-2');

    useSimulatorPanelStore.getState().closeDevice(A, 'U-2');
    expect(tabsOf(A)).toEqual({ udids: ['U-1', 'U-3'], activeUdid: 'U-3' });

    // Closing the last one leaves nothing selected rather than a dangling udid.
    useSimulatorPanelStore.getState().closeDevice(A, 'U-1');
    useSimulatorPanelStore.getState().closeDevice(A, 'U-3');
    expect(tabsOf(A)).toEqual({ udids: [], activeUdid: null });
  });

  it('leaves the active tab alone when a background one closes', () => {
    open(A, 'U-1');
    open(A, 'U-2');
    useSimulatorPanelStore.getState().closeDevice(A, 'U-1');
    expect(tabsOf(A)).toEqual({ udids: ['U-2'], activeUdid: 'U-2' });
  });
});
