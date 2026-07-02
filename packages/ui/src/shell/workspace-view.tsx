import type { SessionId, SessionInfo, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { ChevronLeftIcon, FolderIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { repositoryLabel } from './repository-label';
import type { BranchStatusComponentType, ThreadGroupViewModel } from './threads-view';
import { CompactSessionRow } from './threads-view';

export interface WorkspaceViewProps {
  workspaces: WorkspaceRecord[];
  workspacesLoading?: boolean;
  /** The same groups the Threads view renders — the drilldown's session list is one group's slice. */
  threadGroups: ThreadGroupViewModel[];
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onImportSession?: (sessionId: SessionId) => void;
  BranchStatusComponent?: BranchStatusComponentType;
  HistoryComponent?: React.ComponentType<{
    cwd: string;
    onImported: (sessionId: SessionId) => void;
  }>;
}

/** Registered workspaces, one level up from Threads — drilling into a row shows its threads. */
export function WorkspaceView({
  workspaces,
  workspacesLoading,
  threadGroups,
  activeId,
  onSelect,
  onStop,
  onImportSession,
  BranchStatusComponent,
  HistoryComponent,
}: WorkspaceViewProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const [drilldownId, setDrilldownId] = useState<WorkspaceId | null>(null);
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace])),
    [workspaces],
  );
  const sessionsByWorkspaceId = useMemo(() => {
    const map = new Map<WorkspaceId, SessionInfo[]>();
    for (const group of threadGroups) {
      if (group.workspace) map.set(group.workspace.workspaceId, group.sessions);
    }
    return map;
  }, [threadGroups]);
  const drilldown = drilldownId ? (workspaceById.get(drilldownId) ?? null) : null;

  if (drilldown) {
    const sessions = sessionsByWorkspaceId.get(drilldown.workspaceId) ?? [];
    return (
      <WorkspaceDrilldown
        workspace={drilldown}
        sessions={sessions}
        activeId={activeId}
        onBack={() => setDrilldownId(null)}
        onSelect={onSelect}
        onStop={onStop}
        onImportSession={onImportSession}
        HistoryComponent={HistoryComponent}
      />
    );
  }

  if (workspacesLoading && workspaces.length === 0) {
    return (
      <div className="space-y-1">
        {createFixedArray(4).map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <FolderIcon />
        </EmptyMedia>
        <EmptyTitle>{t('workspaceEmptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('workspaceEmptyHint')}</EmptyDescription>
      </Empty>
    );
  }

  return (
    <ul className="space-y-0.5">
      {workspaces.map((workspace) => (
        <li key={workspace.workspaceId}>
          <WorkspaceRow
            workspace={workspace}
            onOpen={() => setDrilldownId(workspace.workspaceId)}
            BranchStatusComponent={BranchStatusComponent}
          />
        </li>
      ))}
    </ul>
  );
}

function WorkspaceRow({
  workspace,
  onOpen,
  BranchStatusComponent,
}: {
  workspace: WorkspaceRecord;
  onOpen: () => void;
  BranchStatusComponent?: BranchStatusComponentType;
}): React.ReactNode {
  const title = workspace.name ?? repositoryLabel(workspace.cwd);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-[var(--lc-sidebar-edge,0.5rem)] py-1.5 text-left outline-none hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="line-clamp-1 w-full font-medium text-sm">{title}</span>
      <span className="flex w-full min-w-0 items-center gap-1.5 font-mono text-muted-foreground text-xs">
        <span className="truncate">{repositoryLabel(workspace.cwd)}</span>
        {BranchStatusComponent && <BranchStatusComponent cwd={workspace.cwd} showDirty />}
      </span>
    </button>
  );
}

function WorkspaceDrilldown({
  workspace,
  sessions,
  activeId,
  onBack,
  onSelect,
  onStop,
  onImportSession,
  HistoryComponent,
}: {
  workspace: WorkspaceRecord;
  sessions: SessionInfo[];
  activeId: SessionId | null;
  onBack: () => void;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onImportSession?: (sessionId: SessionId) => void;
  HistoryComponent?: React.ComponentType<{
    cwd: string;
    onImported: (sessionId: SessionId) => void;
  }>;
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const title = workspace.name ?? repositoryLabel(workspace.cwd);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 px-[var(--lc-sidebar-edge,0.5rem)] text-muted-foreground text-xs hover:text-foreground"
      >
        <ChevronLeftIcon className="size-3.5" />
        {t('back')}
      </button>
      <div className={cn('truncate px-[var(--lc-sidebar-edge,0.5rem)] font-medium text-sm')}>
        {title}
      </div>
      <div className="space-y-0.5">
        {sessions.map((session) => (
          <CompactSessionRow
            key={session.sessionId}
            active={session.sessionId === activeId}
            session={session}
            onSelect={() => onSelect(session.sessionId)}
            onStop={() => onStop(session.sessionId)}
          />
        ))}
      </div>
      {HistoryComponent && onImportSession && (
        <div>
          <div className="px-[var(--lc-sidebar-edge,0.5rem)] pb-1 font-medium text-muted-foreground text-xs">
            {t('importHistoryTitle')}
          </div>
          <HistoryComponent cwd={workspace.cwd} onImported={onImportSession} />
        </div>
      )}
    </div>
  );
}
