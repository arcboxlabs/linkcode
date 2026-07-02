import { useSortable } from '@dnd-kit/react/sortable';
import type { SessionInfo, SessionStatus } from '@linkcode/schema';
import { PinIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { AGENT_LABELS, AgentIcon } from '../agent-icon';
import { repositoryLabel } from '../repository-label';
import { useRelativeTimeLabel } from '../use-relative-time-label';

const STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-info',
  idle: 'bg-muted-foreground/40',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted-foreground/25',
};

const ROW_ACTION_CLASS =
  'flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring';

export interface ThreadRowProps {
  session: SessionInfo;
  active: boolean;
  pinned: boolean;
  /** The row's index within its group's rendered (visible) list — feeds the sortable. */
  sortIndex: number;
  /** The group's `collapseKey` — scopes dragging to the row's own group. */
  sortGroup: string;
  onSelect: () => void;
  onStop: () => void;
  onTogglePin: () => void;
}

/** One thread row: ghost agent icon, single-line title, status dot. The relative time lives in a tooltip. */
export function ThreadRow({
  session,
  active,
  pinned,
  sortIndex,
  sortGroup,
  onSelect,
  onStop,
  onTogglePin,
}: ThreadRowProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const agent = AGENT_LABELS[session.kind];
  const title = session.title ?? `${agent} in ${repositoryLabel(session.cwd)}`;
  const createdAtLabel = useRelativeTimeLabel(session.createdAt);
  const { ref: sortableRef } = useSortable({
    id: session.sessionId,
    index: sortIndex,
    group: sortGroup,
    type: 'thread',
    data: { groupKey: sortGroup },
    // Threads never leave their group: the group derives from the session's cwd.
    accept: (source) => source.type === 'thread' && source.data.groupKey === sortGroup,
  });

  return (
    <div
      ref={sortableRef}
      className={cn(
        'group relative rounded-md',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/70',
      )}
    >
      {active && (
        <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />
      )}
      <button
        type="button"
        title={createdAtLabel}
        className="flex h-7 w-full min-w-0 items-center gap-[var(--lc-sidebar-gap,0.5rem)] rounded-md px-[var(--lc-sidebar-edge,0.5rem)] pr-14 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="relative shrink-0">
          <AgentIcon kind={session.kind} variant="ghost" className="text-muted-foreground" />
          <span
            aria-hidden
            className={cn(
              'absolute -right-1 -bottom-1 size-1.5 rounded-full ring-2 ring-sidebar',
              STATUS_DOT_CLASS[session.status],
            )}
          />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{title}</span>
      </button>
      <div className="-translate-y-1/2 absolute top-1/2 right-1 flex items-center gap-0.5">
        <button
          type="button"
          aria-label={pinned ? t('unpinThread') : t('pinThread')}
          title={pinned ? t('unpinThread') : t('pinThread')}
          onClick={onTogglePin}
          className={cn(
            ROW_ACTION_CLASS,
            pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <PinIcon className={cn('size-3.5', pinned && 'fill-current')} />
        </button>
        <button
          type="button"
          aria-label={t('stopThread')}
          title={t('stopThread')}
          onClick={onStop}
          className={cn(ROW_ACTION_CLASS, 'opacity-0 group-hover:opacity-100')}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
