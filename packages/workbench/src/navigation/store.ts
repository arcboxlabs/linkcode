import { trueFn } from 'foxts/noop';
import { create } from 'zustand';
import { useSessionSelectionStore } from '../surface/selection-store';
import type { NavHistoryStacks, NavLocation } from './history';
import { recordTransition, travel } from './history';

const SETTINGS_LOCATION: NavLocation = { surface: 'settings' };

interface NavigationHistoryState extends NavHistoryStacks {
  /** Whether the settings surface overlays the workbench. Desktop renders this; webview's
   * settings is a router page and never sets it. */
  settingsOpen: boolean;
  record: (from: NavLocation | null, to: NavLocation) => void;
  /** Moves one step and returns the location to apply, or null when the stack exhausts. */
  travel: (
    dir: 'back' | 'forward',
    current: NavLocation | null,
    isReachable: (location: NavLocation) => boolean,
  ) => NavLocation | null;
  /** Internal switch used by the traversal/apply paths; does not touch history. */
  setSettingsOpen: (open: boolean) => void;
  /** Records main → settings and raises the overlay. No-op while already open. Callable from
   * module scope (the menubar handler), even while the daemon is unreachable. */
  openSettings: () => void;
  /** History-back out of the settings surface (Esc, the settings sidebar Back). */
  backFromSettings: () => void;
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
  settingsOpen: false,
  record: (from, to) => set(recordTransition(get(), from, to)),
  travel(dir, current, isReachable) {
    const { stacks, target } = travel(get(), dir, current, isReachable);
    set(stacks);
    return target;
  },
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openSettings() {
    if (get().settingsOpen) return;
    // Module-scope callers can't see the hook's fallback-resolved thread or draft, so the origin
    // is the explicit selection or nothing. Esc still visually returns either way — the workbench
    // underneath keeps its state while covered.
    const { selectedId } = useSessionSelectionStore.getState();
    const from: NavLocation | null = selectedId
      ? { surface: 'thread', sessionId: selectedId }
      : null;
    get().record(from, SETTINGS_LOCATION);
    set({ settingsOpen: true });
  },
  backFromSettings() {
    if (!get().settingsOpen) return;
    // Pops exactly one entry; `travel` keeps the bookkeeping ({settings} moves onto forward on a
    // hit; an empty stack leaves forward alone). Threads apply through the selection store — no
    // cold-session resume, and a dead id resolves through the workbench's preferred/most-recent
    // fallback. Draft targets apply as close-only: the draft underneath is still showing.
    const target = get().travel('back', SETTINGS_LOCATION, trueFn);
    if (target?.surface === 'thread') {
      useSessionSelectionStore.getState().setSelectedId(target.sessionId);
    }
    set({ settingsOpen: false });
  },
}));
