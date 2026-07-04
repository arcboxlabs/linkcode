import { move } from '@dnd-kit/helpers';
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import type { SessionId, SessionInfo, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { useTranslations } from 'use-intl';
import { repositoryLabel } from './repository-label';
import type { BranchStatusComponentType } from './sidebar';
import {
  AddWorkspaceRow,
  ChatsSection,
  ShowMoreToggle,
  SIDEBAR_SORTABLE_SENSORS,
  ThreadGroupHeader,
  ThreadRow,
} from './sidebar';

/** One workspace's sessions, or the fallback bucket (`workspace: null`) for an unmatched `cwd`. */
export interface ThreadGroupViewModel {
  key: string;
  /** Identity `collapsed` is persisted against — see workbench's `ThreadGroup.collapseKey`. */
  collapseKey: string;
  workspace: WorkspaceRecord | null;
  /** Every session in the group, most recent first — the header's count reflects this length. */
  sessions: SessionInfo[];
  /** The subset actually rendered, honoring the collapse and preview-truncation state below. */
  visibleSessions: SessionInfo[];
  /** Whether a Show more/Show less toggle should render. */
  hasOverflow: boolean;
  collapsed: boolean;
  previewExpanded: boolean;
  historyOpen: boolean;
  /** True for the daemon-owned chat workspace's group — rendered in "Chats", not "Projects". */
  isChat: boolean;
}

export interface ThreadsViewProps {
  groups: ThreadGroupViewModel[];
  workspacesLoading?: boolean;
  activeId: SessionId | null;
  /** Threads pinned to the top of their group, in pin order. */
  pinnedSessionIds: readonly SessionId[];
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  /** Persists a group drag: the full new project-group order, as `collapseKey`s. */
  onReorderGroups: (orderedCollapseKeys: string[]) => void;
  /** Persists a thread drag within a group: `activeId` landed before/after `overId`. */
  onReorderThreads: (
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ) => void;
  /** Opens the new-session page, optionally preselecting a workspace (group "+", Chats "+"). */
  onStartDraft: (workspaceId?: WorkspaceId) => void;
  onImportSession?: (sessionId: SessionId) => void;
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
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

/** The sidebar's two sections: "Projects" (the grouped tree) and the flat "Chats" list. */
export function ThreadsView({
  groups,
  workspacesLoading,
  activeId,
  pinnedSessionIds,
  onSelect,
  onStop,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onStartDraft,
  onImportSession,
  onPickDirectory,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onTogglePreviewExpanded,
  onToggleImportHistory,
  BranchStatusComponent,
  HistoryComponent,
}: ThreadsViewProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const projectGroups: ThreadGroupViewModel[] = [];
  let chatGroup: ThreadGroupViewModel | undefined;
  for (const group of groups) {
    if (group.isChat) chatGroup = group;
    else projectGroups.push(group);
  }

  // The optimistic preview must never cross the pin boundary: the drop would be clamped anyway
  // (pin membership only changes via the pin button), and committing an order that disagrees
  // with the plugin's DOM mutation leaves React reconciling against stale node positions.
  // Preventing the dragover skips the preview for that target — the sortable checks
  // `defaultPrevented` — so the DOM only ever moves where the drop can actually land.
  function handleDragOver(event: DragOverEvent): void {
    const source = event.operation.source;
    const target = event.operation.target;
    if (!source || !target || source.type !== 'thread') return;
    if (target.type !== 'thread') {
      event.preventDefault();
      return;
    }
    const sourcePinned = pinnedSessionIds.includes(source.id as SessionId);
    const targetPinned = pinnedSessionIds.includes(target.id as SessionId);
    if (sourcePinned !== targetPinned) event.preventDefault();
  }

  // The optimistic reorder preview is the library's; state only changes here, on drop.
  function handleDragEnd(event: DragEndEvent): void {
    if (event.canceled) return;
    const source = event.operation.source;
    if (!source) return;

    if (source.type === 'group') {
      const keys = projectGroups.flatMap((group) =>
        group.workspace === null ? [] : [group.collapseKey],
      );
      const reordered = move(keys, event);
      if (reordered.some((key, index) => key !== keys[index])) onReorderGroups(reordered);
      return;
    }

    if (source.type !== 'thread') return;
    const groupKey: unknown = source.data.groupKey;
    if (typeof groupKey !== 'string') return;
    const group = groups.find((candidate) => candidate.collapseKey === groupKey);
    if (!group) return;
    const visibleIds = group.visibleSessions.map((session) => session.sessionId);
    const reordered = move(visibleIds, event);
    const activeId = source.id as SessionId;
    const oldIndex = visibleIds.indexOf(activeId);
    const newIndex = reordered.indexOf(activeId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
    const overId = visibleIds[newIndex];
    onReorderThreads(groupKey, activeId, overId, newIndex > oldIndex ? 'after' : 'before');
  }

  return (
    <DragDropProvider
      sensors={SIDEBAR_SORTABLE_SENSORS}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="px-[var(--lc-sidebar-edge,0.5rem)] pb-1 font-medium text-muted-foreground text-xs">
            {t('projects')}
          </div>
          {projectGroups.length === 0 && workspacesLoading && (
            <div className="space-y-1">
              {createFixedArray(3).map((i) => (
                <Skeleton key={i} className="h-6 w-full rounded-md" />
              ))}
            </div>
          )}
          {projectGroups.length === 0 && !workspacesLoading && (
            <div className="px-[calc(var(--lc-sidebar-edge,0.5rem)+0.25rem)] py-6 text-center text-muted-foreground text-sm">
              {t('emptyTitle')}
            </div>
          )}
          {projectGroups.map((group, index) => (
            <ThreadGroupSection
              key={group.key}
              group={group}
              sortIndex={index}
              activeId={activeId}
              pinnedSessionIds={pinnedSessionIds}
              onSelect={onSelect}
              onStop={onStop}
              onToggleSessionPinned={onToggleSessionPinned}
              onStartDraft={onStartDraft}
              onImportSession={onImportSession}
              onRenameWorkspace={onRenameWorkspace}
              onArchiveWorkspace={onArchiveWorkspace}
              onToggleGroupCollapsed={onToggleGroupCollapsed}
              onTogglePreviewExpanded={onTogglePreviewExpanded}
              onToggleImportHistory={onToggleImportHistory}
              BranchStatusComponent={BranchStatusComponent}
              HistoryComponent={HistoryComponent}
            />
          ))}
          <AddWorkspaceRow
            onPickDirectory={onPickDirectory}
            onRegisterWorkspace={onRegisterWorkspace}
          />
        </div>

        <ChatsSection
          workspace={chatGroup?.workspace ?? null}
          sessions={chatGroup?.visibleSessions ?? []}
          hasOverflow={chatGroup?.hasOverflow ?? false}
          previewExpanded={chatGroup?.previewExpanded ?? false}
          groupKey={chatGroup?.key ?? 'chat'}
          sortKey={chatGroup?.collapseKey ?? 'chat'}
          activeId={activeId}
          pinnedSessionIds={pinnedSessionIds}
          onSelect={onSelect}
          onStop={onStop}
          onToggleSessionPinned={onToggleSessionPinned}
          onStartDraft={onStartDraft}
          onTogglePreviewExpanded={onTogglePreviewExpanded}
        />
      </div>
    </DragDropProvider>
  );
}

function ThreadGroupSection({
  group,
  sortIndex,
  activeId,
  pinnedSessionIds,
  onSelect,
  onStop,
  onToggleSessionPinned,
  onStartDraft,
  onImportSession,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onTogglePreviewExpanded,
  onToggleImportHistory,
  BranchStatusComponent,
  HistoryComponent,
}: {
  group: ThreadGroupViewModel;
  /** The group's index among the rendered project groups — feeds the sortable. */
  sortIndex: number;
  activeId: SessionId | null;
  pinnedSessionIds: readonly SessionId[];
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  onStartDraft: (workspaceId?: WorkspaceId) => void;
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
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const { workspace } = group;
  const title = workspace
    ? (workspace.name ?? repositoryLabel(workspace.cwd))
    : t('unregisteredGroup');
  // The whole section is the sortable element; the header row is its drag handle. The
  // unregistered fallback group is not sortable — it always renders last.
  const { ref: sectionRef, handleRef } = useSortable({
    id: group.collapseKey,
    index: sortIndex,
    type: 'group',
    accept: 'group',
    disabled: workspace === null,
  });

  return (
    <section ref={sectionRef}>
      <ThreadGroupHeader
        dragHandleRef={workspace ? handleRef : undefined}
        title={title}
        workspace={workspace}
        sessionCount={group.sessions.length}
        collapsed={group.collapsed}
        onToggleCollapsed={() => onToggleGroupCollapsed(group.collapseKey)}
        onNewThread={workspace ? () => onStartDraft(workspace.workspaceId) : undefined}
        onRename={workspace ? (name) => onRenameWorkspace(workspace.workspaceId, name) : undefined}
        onArchive={workspace ? () => onArchiveWorkspace(workspace.workspaceId) : undefined}
        historyOpen={group.historyOpen}
        onToggleHistory={
          workspace && HistoryComponent ? () => onToggleImportHistory(group.key) : undefined
        }
        BranchStatusComponent={BranchStatusComponent}
      />
      <div className="pl-3">
        {group.visibleSessions.length > 0 && (
          <div className="space-y-0.5">
            {group.visibleSessions.map((session, index) => (
              <ThreadRow
                key={session.sessionId}
                active={session.sessionId === activeId}
                pinned={pinnedSessionIds.includes(session.sessionId)}
                sortIndex={index}
                sortGroup={group.collapseKey}
                session={session}
                onSelect={() => onSelect(session.sessionId)}
                onStop={() => onStop(session.sessionId)}
                onTogglePin={() => onToggleSessionPinned(session.sessionId)}
              />
            ))}
          </div>
        )}
        {!group.collapsed && group.hasOverflow && (
          <ShowMoreToggle
            expanded={group.previewExpanded}
            onToggle={() => onTogglePreviewExpanded(group.key)}
          />
        )}
      </div>
      {!group.collapsed &&
        group.historyOpen &&
        workspace &&
        HistoryComponent &&
        onImportSession && (
          <div className="pt-1">
            <div className="px-[var(--lc-sidebar-edge,0.5rem)] pb-1 font-medium text-muted-foreground text-xs">
              {t('importHistoryTitle')}
            </div>
            <HistoryComponent cwd={workspace.cwd} onImported={onImportSession} />
          </div>
        )}
    </section>
  );
}
