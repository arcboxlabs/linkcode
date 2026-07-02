import type {
  AgentKind,
  SessionId,
  SessionInfo,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { useTranslations } from 'use-intl';
import { repositoryLabel } from './repository-label';
import type { BranchStatusComponentType } from './sidebar';
import {
  AddWorkspaceRow,
  ChatsSection,
  ShowMoreToggle,
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
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
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
  onSelect,
  onStop,
  onCreate,
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

  return (
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
        {projectGroups.map((group) => (
          <ThreadGroupSection
            key={group.key}
            group={group}
            activeId={activeId}
            onSelect={onSelect}
            onStop={onStop}
            onCreate={onCreate}
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
        activeId={activeId}
        onSelect={onSelect}
        onStop={onStop}
        onCreate={onCreate}
        onTogglePreviewExpanded={onTogglePreviewExpanded}
      />
    </div>
  );
}

function ThreadGroupSection({
  group,
  activeId,
  onSelect,
  onStop,
  onCreate,
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
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
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

  return (
    <section>
      <ThreadGroupHeader
        title={title}
        workspace={workspace}
        sessionCount={group.sessions.length}
        collapsed={group.collapsed}
        onToggleCollapsed={() => onToggleGroupCollapsed(group.collapseKey)}
        onCreateThread={workspace ? (kind) => onCreate({ kind, cwd: workspace.cwd }) : undefined}
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
            {group.visibleSessions.map((session) => (
              <ThreadRow
                key={session.sessionId}
                active={session.sessionId === activeId}
                session={session}
                onSelect={() => onSelect(session.sessionId)}
                onStop={() => onStop(session.sessionId)}
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
