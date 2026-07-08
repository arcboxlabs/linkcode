import type { SessionId, WorkspaceId } from '@linkcode/schema';
import { create } from 'zustand';

export interface WorkbenchSessionDraft {
  /** Explicit workspace preselection (group "+", Chats "+"); null = resolve the default. */
  workspaceId: WorkspaceId | null;
}

interface SessionSelectionState {
  /** Explicit selection; null falls back to the preferred/most recent session. */
  selectedId: SessionId | null;
  /** Non-null while the new-session page is explicitly open; selecting a session clears it. */
  draft: WorkbenchSessionDraft | null;
  setSelectedId: (id: SessionId | null) => void;
  setDraft: (draft: WorkbenchSessionDraft | null) => void;
}

/**
 * The workbench main-surface state (selected session + explicit new-thread draft) lives outside
 * the `Workbench` tree so surfaces mounted elsewhere — command palette, shortcuts, notification
 * click-through, and secondary `useWorkbenchSessions` instances (the history import pane) — drive
 * the same state the visible workbench renders. Instance-local copies would desynchronize the
 * apply paths (a selection made from one instance must clear the draft everywhere). Not
 * persisted: a fresh window starts at the default session.
 */
export const useSessionSelectionStore = create<SessionSelectionState>()((set) => ({
  selectedId: null,
  draft: null,
  setSelectedId: (id) => set({ selectedId: id }),
  setDraft: (draft) => set({ draft }),
}));
