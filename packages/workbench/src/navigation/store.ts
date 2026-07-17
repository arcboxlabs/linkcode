import { trueFn } from 'foxts/noop';
import { create } from 'zustand';
import { useSessionSelectionStore } from '../surface/selection-store';
import type { NavHistoryStacks, NavLocation, WorkbenchOverlaySurface } from './history';
import { recordTransition, travel } from './history';

export type { WorkbenchOverlaySurface } from './history';

interface NavigationHistoryState extends NavHistoryStacks {
  /** The surface overlaying the workbench, or null when the workbench shows. Desktop renders
   * these; webview's settings is a router page and never sets it. */
  overlay: WorkbenchOverlaySurface | null;
  record: (from: NavLocation | null, to: NavLocation) => void;
  /** Moves one step and returns the location to apply, or null when the stack exhausts. */
  travel: (
    dir: 'back' | 'forward',
    current: NavLocation | null,
    isReachable: (location: NavLocation) => boolean,
  ) => NavLocation | null;
  /** Internal switch used by the traversal/apply paths; does not touch history. */
  setOverlay: (overlay: WorkbenchOverlaySurface | null) => void;
  /** Records current → the overlay surface and raises it. No-op while that surface is already
   * up. Callable from module scope (the menubar handler), even while the daemon is unreachable. */
  openOverlay: (surface: WorkbenchOverlaySurface) => void;
  /** History-back out of the current overlay surface (Esc, the sidebar Back rows). */
  backFromOverlay: () => void;
}

/**
 * Per-window navigation history over the workbench's main surface, VS Code-style: an in-memory
 * stack of locations, no URLs. Module scope (like the palette store) so any surface can traverse
 * it; not persisted — a fresh window starts with empty history.
 */
export const useNavigationHistoryStore = create<NavigationHistoryState>()((set, get) => ({
  back: [],
  forward: [],
  overlay: null,
  record: (from, to) => set(recordTransition(get(), from, to)),
  travel(dir, current, isReachable) {
    const { stacks, target } = travel(get(), dir, current, isReachable);
    set(stacks);
    return target;
  },
  setOverlay: (overlay) => set({ overlay }),
  openOverlay(surface) {
    if (get().overlay === surface) return;
    // Module-scope callers can't see the hook's fallback-resolved thread, so the origin is the
    // open draft, the explicit selection, or nothing — Esc still visually returns either way,
    // the covered surface keeps its state.
    const { selectedId, draft } = useSessionSelectionStore.getState();
    const from: NavLocation | null = draft
      ? { surface: 'new-thread', workspaceId: draft.workspaceId }
      : selectedId
        ? { surface: 'thread', sessionId: selectedId }
        : null;
    get().record(from, { surface });
    set({ overlay: surface });
  },
  backFromOverlay() {
    const { overlay } = get();
    if (overlay === null) return;
    // Pops exactly one entry; `travel` keeps the bookkeeping (the overlay location moves onto
    // forward on a hit; an empty stack leaves forward alone). Overlay-surface targets re-raise
    // that overlay. Thread and draft targets apply through the selection store — no cold-session
    // resume, and a dead id resolves through the workbench's preferred/most-recent fallback.
    const target = get().travel('back', { surface: overlay }, trueFn);
    if (target !== null && target.surface !== 'thread' && target.surface !== 'new-thread') {
      set({ overlay: target.surface });
      return;
    }
    const selection = useSessionSelectionStore.getState();
    if (target?.surface === 'thread') {
      // setSelectedId atomically exits any draft (see the selection store).
      selection.setSelectedId(target.sessionId);
    } else if (target?.surface === 'new-thread') {
      selection.startDraft({ workspaceId: target.workspaceId });
    }
    set({ overlay: null });
  },
}));
