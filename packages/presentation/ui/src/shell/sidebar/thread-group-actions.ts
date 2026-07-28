import type { SessionId, WorkspaceId } from '@linkcode/schema';
import type { BranchStatusComponentType } from './branch-status';
import type { ThreadImMenuComponentType } from './thread-im-menu';

/** The sidebar's top-level collapsible sections. Mirrored by the workbench collapse store. */
export type SidebarSectionKey = 'pinned' | 'projects' | 'chats';

/** Session/group callbacks shared verbatim by `SessionSidebar`, `ThreadsView`, and the per-group
 * section; `ShellFrame` renames a few at its public boundary and reassembles them with `Pick`. */
export interface ThreadGroupActions {
  onSelect: (id: SessionId) => void;
  /** Stop the session if live and remove it from the list; re-importable from provider history. */
  onClose: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  /** Opens the new-session page, optionally preselecting a workspace (group "+", Chats "+"). */
  onStartDraft: (workspaceId?: WorkspaceId) => void;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => Promise<void>;
  onArchiveWorkspace: (workspaceId: WorkspaceId) => Promise<void>;
  onToggleGroupCollapsed: (collapseKey: string) => void;
  onToggleSectionCollapsed: (section: SidebarSectionKey) => void;
  onTogglePreviewExpanded: (groupKey: string) => void;
  BranchStatusComponent?: BranchStatusComponentType;
  /** Per-thread IM (Telegram) menu items; the row's ellipsis menu renders only when provided. */
  ImMenuComponent?: ThreadImMenuComponentType;
}

/** The per-group selection/pin state that travels alongside `ThreadGroupActions`. */
export interface ThreadGroupState {
  activeId: SessionId | null;
  /** Threads listed in the "Pinned" section, in pin order. */
  pinnedSessionIds: readonly SessionId[];
  /** Top-level sections currently collapsed; all default open. */
  collapsedSections: readonly SidebarSectionKey[];
}
