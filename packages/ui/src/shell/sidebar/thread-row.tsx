import { useSortable } from '@dnd-kit/react/sortable';
import type { SessionInfo, SessionStatus } from '@linkcode/schema';
import { SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { PinIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS, AgentIcon } from '../../chat/agent-icon';
import { withTooltip } from '../../chat/with-tooltip';
import { cn } from '../../lib/cn';
import { repositoryLabel } from '../repository-label';
import { useRelativeTimeLabel } from '../use-relative-time-label';
import { ROW_ACTION_CLASS, ROW_HOVER_PE_CLASS, RowActionsCluster } from './row-actions';

export const SESSION_STATUS_DOT_CLASS: Record<SessionStatus, string> = {
  starting: 'bg-info',
  idle: 'bg-muted-foreground/40',
  running: 'bg-success',
  'awaiting-input': 'bg-warning',
  stopped: 'bg-muted-foreground/25',
};

export interface ThreadRowProps {
  session: SessionInfo;
  active: boolean;
  pinned: boolean;
  /** The row's index within its group's rendered (visible) list — feeds the sortable. */
  sortIndex: number;
  /** The group's `collapseKey` — scopes dragging to the row's own group. */
  sortGroup: string;
  onSelect: () => void;
  /** Stop the session if live and remove it from the list; re-importable from provider history. */
  onClose: () => void;
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
  onClose,
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
    <SidebarMenuItem ref={sortableRef}>
      {withTooltip(
        <SidebarMenuButton
          isActive={active}
          onClick={onSelect}
          className={cn(
            // No font-medium when active: IBM Plex Sans lacks CJK, so 500 falls back to
            // PingFang Medium and mixed-script titles read artificially bold.
            'transition-none data-[active=true]:font-normal',
            // Keep the row highlighted while the pointer is over the absolute action cluster.
            'group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground',
            // A pinned row shows its pin at rest, so it keeps the action space reserved.
            pinned ? 'pe-12' : ROW_HOVER_PE_CLASS,
          )}
        >
          <span className="relative shrink-0">
            <AgentIcon kind={session.kind} variant="ghost" className="text-muted-foreground" />
            <span
              aria-hidden
              className={cn(
                'absolute -right-1 -bottom-1 size-1.5 rounded-full ring-2 ring-sidebar transition-colors',
                SESSION_STATUS_DOT_CLASS[session.status],
              )}
            />
          </span>
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </SidebarMenuButton>,
        createdAtLabel,
      )}
      <RowActionsCluster>
        <button
          type="button"
          aria-label={pinned ? t('unpinThread') : t('pinThread')}
          title={pinned ? t('unpinThread') : t('pinThread')}
          onClick={onTogglePin}
          className={cn(ROW_ACTION_CLASS, pinned && 'opacity-100')}
        >
          <PinIcon className={cn(pinned && 'fill-current')} />
        </button>
        <button
          type="button"
          aria-label={t('closeThread')}
          title={t('closeThread')}
          onClick={onClose}
          className={ROW_ACTION_CLASS}
        >
          <XIcon />
        </button>
      </RowActionsCluster>
    </SidebarMenuItem>
  );
}
