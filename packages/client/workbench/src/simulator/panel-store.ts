import type { SessionId } from '@linkcode/schema';
import { MAX_SIMULATORS_PER_SESSION } from '@linkcode/schema';
import { create } from 'zustand';

/** The devices one thread has open, in tab order, plus which one is in front. */
interface DeviceTabs {
  udids: readonly string[];
  activeUdid: string | null;
}

const EMPTY: DeviceTabs = { udids: [], activeUdid: null };

interface SimulatorPanelState {
  /** Open device tabs per thread. Keyed by session id; `''` is the no-thread bucket. */
  tabsBySession: Readonly<Record<string, DeviceTabs>>;
  /** Threads that already spent their one automatic reveal, or whose section the user closed. */
  autoRevealSuppressed: Readonly<Record<string, true>>;
  /** Open a device tab (or bring an already-open one forward). Refused past the per-thread cap. */
  openDevice: (sessionKey: string, udid: string) => void;
  closeDevice: (sessionKey: string, udid: string) => void;
  selectDevice: (sessionKey: string, udid: string) => void;
  suppressAutoReveal: (sessionId: SessionId) => void;
}

/**
 * Which simulators each thread has open, at module scope rather than inside the panel: agent
 * activity opens a device (CODE-418) while the panel may not even be mounted yet.
 *
 * Keyed by thread because the device cap is per thread — the engine refuses a fifth claim for one
 * session, so the tab strip must count the same way (CODE-421).
 *
 * Deliberately not persisted — it tracks what is happening right now, and a device restored from a
 * previous run is as likely to be gone as to be useful.
 */
export const useSimulatorPanelStore = create<SimulatorPanelState>()((set) => ({
  tabsBySession: {},
  autoRevealSuppressed: {},
  openDevice: (sessionKey, udid) =>
    set((state) => {
      const tabs = state.tabsBySession[sessionKey] ?? EMPTY;
      if (tabs.udids.includes(udid)) {
        return withTabs(state, sessionKey, { ...tabs, activeUdid: udid });
      }
      // The host would refuse the claim anyway; stopping here keeps the panel from opening a tab
      // that can never stream.
      if (tabs.udids.length >= MAX_SIMULATORS_PER_SESSION) return state;
      return withTabs(state, sessionKey, { udids: [...tabs.udids, udid], activeUdid: udid });
    }),
  closeDevice: (sessionKey, udid) =>
    set((state) => {
      const tabs = state.tabsBySession[sessionKey] ?? EMPTY;
      const index = tabs.udids.indexOf(udid);
      if (index === -1) return state;
      const udids = tabs.udids.filter((open) => open !== udid);
      // Closing the front tab falls back to a neighbour, mirroring the terminal section's tabs.
      const activeUdid =
        tabs.activeUdid === udid
          ? (udids[Math.min(index, udids.length - 1)] ?? null)
          : tabs.activeUdid;
      return withTabs(state, sessionKey, { udids, activeUdid });
    }),
  selectDevice: (sessionKey, udid) =>
    set((state) => {
      const tabs = state.tabsBySession[sessionKey] ?? EMPTY;
      if (!tabs.udids.includes(udid)) return state;
      return withTabs(state, sessionKey, { ...tabs, activeUdid: udid });
    }),
  suppressAutoReveal: (sessionId) =>
    set((state) => ({
      autoRevealSuppressed: { ...state.autoRevealSuppressed, [sessionId]: true },
    })),
}));

function withTabs(
  state: SimulatorPanelState,
  sessionKey: string,
  tabs: DeviceTabs,
): Pick<SimulatorPanelState, 'tabsBySession'> {
  return { tabsBySession: { ...state.tabsBySession, [sessionKey]: tabs } };
}

/** The devices `sessionKey` has open. Stable empty value, so it is safe as a selector result. */
export function selectDeviceTabs(state: SimulatorPanelState, sessionKey: string): DeviceTabs {
  return state.tabsBySession[sessionKey] ?? EMPTY;
}

/** The panel's store key for a thread; `''` stands for "no thread selected". */
export function simulatorSessionKey(sessionId: SessionId | null): string {
  return sessionId ?? '';
}

/**
 * Stop auto-revealing the Simulator section for `sessionId`. Called both after the one automatic
 * reveal and when the user closes the section — from then on the panel is theirs, and an agent
 * still working the device says so through the badge instead of moving the panel again.
 */
export function suppressSimulatorAutoReveal(sessionId: SessionId): void {
  useSimulatorPanelStore.getState().suppressAutoReveal(sessionId);
}
