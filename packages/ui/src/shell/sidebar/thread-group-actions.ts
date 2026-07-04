import type { AgentKind, SessionId, WorkspaceId } from '@linkcode/schema';
import type { BranchStatusComponentType } from './branch-status';

/**
 * Session/group interaction callbacks shared verbatim by `SessionSidebar`, `ThreadsView`, and the
 * per-group section they both render. `ShellFrame` renames a few of these at its public boundary
 * (`onSelect` → `onSelectSession`, etc.) and reassembles them with `Pick` instead of extending.
 */
export interface ThreadGroupActions {
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
  /** Called once a history entry finishes importing as a new thread. */
  onImportSession?: (sessionId: SessionId) => void;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => Promise<void>;
  onArchiveWorkspace: (workspaceId: WorkspaceId) => Promise<void>;
  onToggleGroupCollapsed: (collapseKey: string) => void;
  onTogglePreviewExpanded: (groupKey: string) => void;
  onToggleImportHistory: (groupKey: string) => void;
  BranchStatusComponent?: BranchStatusComponentType;
  HistoryComponent?: React.ComponentType<{
    cwd: string;
    onImported: (sessionId: SessionId) => void;
  }>;
}

/** The per-group selection/pin state that travels alongside `ThreadGroupActions`. */
export interface ThreadGroupState {
  activeId: SessionId | null;
  /** Threads pinned to the top of their group, in pin order. */
  pinnedSessionIds: readonly SessionId[];
}
