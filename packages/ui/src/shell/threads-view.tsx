import type { SessionId, SessionInfo, SessionStatus, WorkspaceRecord } from '@linkcode/schema';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { AGENT_LABELS, AgentIcon } from './agent-icon';
import { relativeTimeLabel } from './relative-time';
import { repositoryLabel } from './repository-label';

/** One workspace's sessions, or the fallback bucket (`workspace: null`) for an unmatched `cwd`. */
export interface ThreadGroupViewModel {
  key: string;
  workspace: WorkspaceRecord | null;
  sessions: SessionInfo[];
}

export type BranchStatusComponentType = React.ComponentType<{ cwd: string; showDirty?: boolean }>;

const STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-info',
  idle: 'bg-muted-foreground/40',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted-foreground/25',
};

export interface ThreadsViewProps {
  groups: ThreadGroupViewModel[];
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  BranchStatusComponent?: BranchStatusComponentType;
}

/** Threads grouped by workspace — the sidebar's default view. */
export function ThreadsView({
  groups,
  activeId,
  onSelect,
  onStop,
  BranchStatusComponent,
}: ThreadsViewProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  if (groups.length === 0) {
    return (
      <div className="px-[calc(var(--lc-sidebar-edge,0.5rem)+0.25rem)] py-6 text-center text-muted-foreground text-sm">
        {t('emptyTitle')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <ThreadGroupSection
          key={group.key}
          group={group}
          activeId={activeId}
          onSelect={onSelect}
          onStop={onStop}
          BranchStatusComponent={BranchStatusComponent}
        />
      ))}
    </div>
  );
}

function ThreadGroupSection({
  group,
  activeId,
  onSelect,
  onStop,
  BranchStatusComponent,
}: {
  group: ThreadGroupViewModel;
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  BranchStatusComponent?: BranchStatusComponentType;
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const title = group.workspace
    ? (group.workspace.name ?? repositoryLabel(group.workspace.cwd))
    : t('unregisteredGroup');

  return (
    <section>
      <div className="flex h-6 items-center gap-[var(--lc-sidebar-gap,0.5rem)] px-[var(--lc-sidebar-edge,0.5rem)] text-muted-foreground text-xs">
        <span className="min-w-0 truncate font-medium">{title}</span>
        {group.workspace && BranchStatusComponent && (
          <BranchStatusComponent cwd={group.workspace.cwd} />
        )}
        <span className="ml-auto shrink-0 tabular-nums">{group.sessions.length}</span>
      </div>
      <div className="space-y-0.5">
        {group.sessions.map((session) => (
          <CompactSessionRow
            key={session.sessionId}
            active={session.sessionId === activeId}
            session={session}
            onSelect={() => onSelect(session.sessionId)}
            onStop={() => onStop(session.sessionId)}
          />
        ))}
      </div>
    </section>
  );
}

export function CompactSessionRow({
  session,
  active,
  onSelect,
  onStop,
}: {
  session: SessionInfo;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const agent = AGENT_LABELS[session.kind];
  const title = session.title ?? `${agent} in ${repositoryLabel(session.cwd)}`;

  return (
    <div
      className={cn(
        'group relative rounded-md',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/70',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary" />}
      <button
        type="button"
        className="flex w-full min-w-0 gap-[var(--lc-sidebar-gap,0.5rem)] rounded-md px-[var(--lc-sidebar-edge,0.5rem)] py-1.5 pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="relative mt-0.5 shrink-0">
          <AgentIcon kind={session.kind} />
          <span
            aria-hidden
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-sidebar',
              STATUS_DOT_CLASS[session.status],
            )}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-medium text-sm leading-snug">{title}</span>
        </span>
        <span className="shrink-0 pt-0.5 text-muted-foreground text-xs tabular-nums">
          {relativeTimeLabel(session.createdAt)}
        </span>
      </button>
      <button
        type="button"
        aria-label={t('stopThread')}
        title={t('stopThread')}
        onClick={onStop}
        className="-translate-y-1/2 absolute top-1/2 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
