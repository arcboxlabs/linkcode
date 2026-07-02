import type { SessionId } from '@linkcode/schema';
import { create } from 'zustand';

interface SessionSelectionState {
  /** Explicit selection; null falls back to the preferred/most recent session. */
  selectedId: SessionId | null;
  setSelectedId: (id: SessionId | null) => void;
}

/**
 * Session selection lives outside the `Workbench` tree so surfaces mounted elsewhere (command
 * palette, shortcuts, notification click-through) can drive the same selection the visible
 * workbench renders. Not persisted: a fresh window starts at the default session.
 */
export const useSessionSelectionStore = create<SessionSelectionState>()((set) => ({
  selectedId: null,
  setSelectedId: (id) => set({ selectedId: id }),
}));
