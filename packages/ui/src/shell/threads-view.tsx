import { move } from '@dnd-kit/helpers';
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/react';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import type { SessionId, SessionInfo, WorkspaceRecord } from '@linkcode/schema';
import { Accordion, AccordionItem, AccordionPanel } from 'coss-ui/components/accordion';
import { SidebarGroup, SidebarMenu } from 'coss-ui/components/sidebar';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { useTranslations } from 'use-intl';
import { changedAccordionValues, openThreadGroupValues } from './accordion-values';
import { repositoryLabel } from './repository-label';
import type { SidebarSectionKey, ThreadGroupActions, ThreadGroupState } from './sidebar';
import {
  AddProjectMenu,
  ChatsSection,
  PinnedSection,
  SectionAccordionTrigger,
  ShowMoreToggle,
  SIDEBAR_SORTABLE_SENSORS,
  ThreadGroupHeader,
  ThreadRow,
} from './sidebar';

const SIDEBAR_SECTIONS = [
  'pinned',
  'projects',
  'chats',
] as const satisfies readonly SidebarSectionKey[];

/** One workspace's sessions, or the fallback bucket (`workspace: null`) for an unmatched `cwd`. */
export interface ThreadGroupViewModel {
  key: string;
  /** Identity `collapsed` is persisted against — see workbench's `ThreadGroup.collapseKey`. */
  collapseKey: string;
  workspace: WorkspaceRecord | null;
  /** Every session in the group, most recent first — the header's count reflects this length. */
  sessions: SessionInfo[];
  /** The preview subset rendered while the group is open. */
  visibleSessions: SessionInfo[];
  /** Whether a Show more/Show less toggle should render. */
  hasOverflow: boolean;
  collapsed: boolean;
  previewExpanded: boolean;
  /** True for the daemon-owned chat workspace's group — rendered in "Chats", not "Projects". */
  isChat: boolean;
  /** True for the synthetic pinned group — rendered as the top-level "Pinned" section. */
  isPinned: boolean;
}

export interface ThreadsViewProps extends ThreadGroupActions, ThreadGroupState {
  groups: ThreadGroupViewModel[];
  workspacesLoading?: boolean;
  /** First load of the session list — the "Chats" section shows a skeleton, not the empty hint. */
  sessionsLoading?: boolean;
  /** Persists a group drag: the full new project-group order, as `collapseKey`s. */
  onReorderGroups: (orderedCollapseKeys: string[]) => void;
  /** Persists a thread drag within a group: `activeId` landed before/after `overId`. */
  onReorderThreads: (
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ) => void;
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  /** Opens the provider history import surface; desktop only — the menu item hides without it. */
  onImportHistory?: () => void;
}

/** The sidebar's two sections: "Projects" (the grouped tree) and the flat "Chats" list. */
export function ThreadsView({
  groups,
  workspacesLoading,
  sessionsLoading,
  activeId,
  pinnedSessionIds,
  collapsedSections,
  onSelect,
  onClose,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onStartDraft,
  onPickDirectory,
  onRegisterWorkspace,
  onImportHistory,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onToggleSectionCollapsed,
  onTogglePreviewExpanded,
  BranchStatusComponent,
  ImMenuComponent,
}: ThreadsViewProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const openSections = SIDEBAR_SECTIONS.filter((section) => !collapsedSections.includes(section));
  const projectGroups: ThreadGroupViewModel[] = [];
  let pinnedGroup: ThreadGroupViewModel | undefined;
  let chatGroup: ThreadGroupViewModel | undefined;
  for (const group of groups) {
    if (group.isPinned) pinnedGroup = group;
    else if (group.isChat) chatGroup = group;
    else projectGroups.push(group);
  }
  const projectGroupKeys = projectGroups.map((group) => group.collapseKey);
  const openGroupKeys = openThreadGroupValues(projectGroups);

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
      {/* Controlled with root-level onValueChange: item-level onOpenChange plus a controlled
          root leaves base-ui's exit transition stuck (panel never reaches data-ending-style). */}
      <Accordion
        multiple
        className="flex flex-col gap-0.5"
        value={openSections}
        onValueChange={(next) => {
          for (const section of changedAccordionValues(SIDEBAR_SECTIONS, openSections, next)) {
            onToggleSectionCollapsed(section);
          }
        }}
      >
        {pinnedGroup && (
          <PinnedSection
            sessions={pinnedGroup.visibleSessions}
            hasOverflow={pinnedGroup.hasOverflow}
            previewExpanded={pinnedGroup.previewExpanded}
            groupKey={pinnedGroup.key}
            sortKey={pinnedGroup.collapseKey}
            activeId={activeId}
            onSelect={onSelect}
            onClose={onClose}
            onToggleSessionPinned={onToggleSessionPinned}
            onTogglePreviewExpanded={onTogglePreviewExpanded}
            ImMenuComponent={ImMenuComponent}
          />
        )}

        <AccordionItem value="projects" className="border-b-0" render={<SidebarGroup />}>
          <SectionAccordionTrigger>{t('projects')}</SectionAccordionTrigger>
          <AddProjectMenu
            onStartDraft={() => onStartDraft()}
            onPickDirectory={onPickDirectory}
            onRegisterWorkspace={onRegisterWorkspace}
            onImportHistory={onImportHistory}
          />
          <AccordionPanel className="flex flex-col gap-0.5 pb-0 text-sidebar-foreground">
            {projectGroups.length === 0 && workspacesLoading && (
              <div className="flex flex-col gap-1">
                {createFixedArray(3).map((i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-lg" />
                ))}
              </div>
            )}
            {projectGroups.length === 0 && !workspacesLoading && (
              <div className="px-3 py-6 text-center text-muted-foreground text-sm">
                {t('emptyTitle')}
              </div>
            )}
            {projectGroups.length > 0 && (
              <Accordion
                multiple
                className="flex flex-col gap-0.5"
                value={openGroupKeys}
                onValueChange={(next) => {
                  for (const key of changedAccordionValues(projectGroupKeys, openGroupKeys, next)) {
                    onToggleGroupCollapsed(key);
                  }
                }}
              >
                {projectGroups.map((group, index) => (
                  <ThreadGroupSection
                    key={group.key}
                    group={group}
                    sortIndex={index}
                    activeId={activeId}
                    pinnedSessionIds={pinnedSessionIds}
                    onSelect={onSelect}
                    onClose={onClose}
                    onToggleSessionPinned={onToggleSessionPinned}
                    onStartDraft={onStartDraft}
                    onRenameWorkspace={onRenameWorkspace}
                    onArchiveWorkspace={onArchiveWorkspace}
                    onTogglePreviewExpanded={onTogglePreviewExpanded}
                    BranchStatusComponent={BranchStatusComponent}
                    ImMenuComponent={ImMenuComponent}
                  />
                ))}
              </Accordion>
            )}
          </AccordionPanel>
        </AccordionItem>

        <ChatsSection
          workspace={chatGroup?.workspace ?? null}
          sessions={chatGroup?.visibleSessions ?? []}
          isLoading={sessionsLoading}
          hasOverflow={chatGroup?.hasOverflow ?? false}
          previewExpanded={chatGroup?.previewExpanded ?? false}
          groupKey={chatGroup?.key ?? 'chat'}
          sortKey={chatGroup?.collapseKey ?? 'chat'}
          activeId={activeId}
          pinnedSessionIds={pinnedSessionIds}
          onSelect={onSelect}
          onClose={onClose}
          onToggleSessionPinned={onToggleSessionPinned}
          onStartDraft={onStartDraft}
          onTogglePreviewExpanded={onTogglePreviewExpanded}
          ImMenuComponent={ImMenuComponent}
        />
      </Accordion>
    </DragDropProvider>
  );
}

function ThreadGroupSection({
  group,
  sortIndex,
  activeId,
  pinnedSessionIds,
  onSelect,
  onClose,
  onToggleSessionPinned,
  onStartDraft,
  onRenameWorkspace,
  onArchiveWorkspace,
  onTogglePreviewExpanded,
  BranchStatusComponent,
  ImMenuComponent,
}: Pick<
  ThreadGroupActions,
  | 'onSelect'
  | 'onClose'
  | 'onToggleSessionPinned'
  | 'onStartDraft'
  | 'onRenameWorkspace'
  | 'onArchiveWorkspace'
  | 'onTogglePreviewExpanded'
  | 'BranchStatusComponent'
  | 'ImMenuComponent'
> &
  Pick<ThreadGroupState, 'activeId' | 'pinnedSessionIds'> & {
    group: ThreadGroupViewModel;
    /** The group's index among the rendered project groups — feeds the sortable. */
    sortIndex: number;
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

  // Keep the open-state preview mounted while the panel closes so base-ui can measure and finish
  // its height transition before unmounting the rows.
  const renderRow = (session: SessionInfo, index: number): React.ReactNode => (
    <ThreadRow
      key={session.sessionId}
      active={session.sessionId === activeId}
      pinned={pinnedSessionIds.includes(session.sessionId)}
      sortIndex={index}
      sortGroup={group.collapseKey}
      session={session}
      onSelect={() => onSelect(session.sessionId)}
      onClose={() => onClose(session.sessionId)}
      onTogglePin={() => onToggleSessionPinned(session.sessionId)}
      ImMenuComponent={ImMenuComponent}
    />
  );

  return (
    <AccordionItem ref={sectionRef} value={group.collapseKey} className="border-b-0">
      <ThreadGroupHeader
        dragHandleRef={workspace ? handleRef : undefined}
        title={title}
        workspace={workspace}
        collapsed={group.collapsed}
        onNewThread={workspace ? () => onStartDraft(workspace.workspaceId) : undefined}
        onRename={workspace ? (name) => onRenameWorkspace(workspace.workspaceId, name) : undefined}
        onArchive={workspace ? () => onArchiveWorkspace(workspace.workspaceId) : undefined}
        BranchStatusComponent={BranchStatusComponent}
      />
      <AccordionPanel className="pb-0 text-sidebar-foreground">
        <SidebarMenu className="gap-0.5 pl-3">
          {group.visibleSessions.map(renderRow)}
          {group.hasOverflow && (
            <ShowMoreToggle
              expanded={group.previewExpanded}
              onToggle={() => onTogglePreviewExpanded(group.key)}
            />
          )}
        </SidebarMenu>
      </AccordionPanel>
    </AccordionItem>
  );
}
