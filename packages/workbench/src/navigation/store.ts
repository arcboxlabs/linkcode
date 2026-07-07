import { create } from 'zustand';
import type { NavHistoryStacks, NavLocation } from './history';
import { recordTransition, travel } from './history';

interface NavigationHistoryState extends NavHistoryStacks {
  record: (from: NavLocation | null, to: NavLocation) => void;
  /** Moves one step and returns the location to apply, or null when the stack exhausts. */
  travel: (
    dir: 'back' | 'forward',
    current: NavLocation | null,
    isReachable: (location: NavLocation) => boolean,
  ) => NavLocation | null;
}

/**
 * Per-window navigation history over the workbench's main surface, VS Code-style: an in-memory
 * stack of locations, no URLs. Module scope (like the palette store) so any surface can traverse
 * it; not persisted — a fresh window starts with empty history.
 *
 * TODO(keybinds): bind go-back/go-forward through the global keybind registry once it exists.
 * Deliberately no per-app keydown wiring — the palette commands and the shells' ‹ › buttons are
 * the only triggers until then.
 */
export const useNavigationHistoryStore = create<NavigationHistoryState>()((set, get) => ({
  back: [],
  forward: [],
  record: (from, to) => set(recordTransition(get(), from, to)),
  travel(dir, current, isReachable) {
    const { stacks, target } = travel(get(), dir, current, isReachable);
    set(stacks);
    return target;
  },
}));
