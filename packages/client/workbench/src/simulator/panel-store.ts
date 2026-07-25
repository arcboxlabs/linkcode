import type { SessionId } from '@linkcode/schema';
import { create } from 'zustand';

interface SimulatorPanelState {
  /** The device the panel shows; `null` lets the panel fall back to the first booted device. */
  selectedUdid: string | null;
  /** Threads that already spent their one automatic reveal, or whose section the user closed. */
  autoRevealSuppressed: Record<string, true>;
  selectDevice: (udid: string) => void;
  suppressAutoReveal: (sessionId: SessionId) => void;
}

/**
 * The Simulator panel's device selection, at module scope rather than inside the panel: agent
 * activity points it at a device (CODE-418) while the panel may not even be mounted yet.
 *
 * Deliberately not persisted — it tracks what is happening right now, and a device restored from a
 * previous run is as likely to be gone as to be useful.
 */
export const useSimulatorPanelStore = create<SimulatorPanelState>()((set) => ({
  selectedUdid: null,
  autoRevealSuppressed: {},
  selectDevice: (udid) => set({ selectedUdid: udid }),
  suppressAutoReveal: (sessionId) =>
    set((state) => ({
      autoRevealSuppressed: { ...state.autoRevealSuppressed, [sessionId]: true },
    })),
}));

/**
 * Stop auto-revealing the Simulator section for `sessionId`. Called both after the one automatic
 * reveal and when the user closes the section — from then on the panel is theirs, and an agent
 * still working the device says so through the badge instead of moving the panel again.
 */
export function suppressSimulatorAutoReveal(sessionId: SessionId): void {
  useSimulatorPanelStore.getState().suppressAutoReveal(sessionId);
}
