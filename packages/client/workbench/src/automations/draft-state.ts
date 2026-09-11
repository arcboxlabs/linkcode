import { create } from 'zustand';

interface DraftState {
  dirty: boolean;
  pending: (() => void) | null;
  setDirty: (dirty: boolean) => void;
  request: (action: () => void) => void;
  discard: () => void;
  stay: () => void;
}

export const useAutomationDraftState = create<DraftState>()((set, get) => ({
  dirty: false,
  pending: null,
  setDirty: (dirty) => set({ dirty }),
  request(action) {
    if (get().dirty) set({ pending: action });
    else action();
  },
  discard() {
    const action = get().pending;
    set({ dirty: false, pending: null });
    action?.();
  },
  stay: () => set({ pending: null }),
}));
