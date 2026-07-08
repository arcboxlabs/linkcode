import { create } from 'zustand';

interface SelectedHostState {
  /** The host the user picked in the footer, or null for the local host. */
  selectedHostId: string | null;
  selectHost: (hostId: string | null) => void;
}

/**
 * Which online cloud host the user has selected. Selection prepares the remote-dial flow (CODE-92);
 * for now it only drives the footer's active-row highlight.
 */
export const useSelectedHostStore = create<SelectedHostState>((set) => ({
  selectedHostId: null,
  selectHost: (selectedHostId) => set({ selectedHostId }),
}));
