import type { SessionId, WorkspaceId } from '@linkcode/schema';
import { create } from 'zustand';

export interface WorkbenchSessionDraft {
  /** Explicit workspace preselection (group "+", Chats "+"); null = resolve the default. */
  workspaceId: WorkspaceId | null;
}

interface SessionSelectionState {
  /** Explicit selection; null falls back to the preferred/most recent session. */
  selectedId: SessionId | null;
  /** Explicit new-session draft; while set, no session is active. Selecting clears it. */
  draft: WorkbenchSessionDraft | null;
  /** Select a session (or clear the selection); atomically exits any draft, or the new-session
   * surface would keep masking the conversation an outside caller just selected. */
  setSelectedId: (id: SessionId | null) => void;
  startDraft: (draft: WorkbenchSessionDraft) => void;
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
  setSelectedId: (id) => set({ selectedId: id, draft: null }),
  startDraft: (draft) => set({ draft }),
}));
