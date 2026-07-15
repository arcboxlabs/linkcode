import { useSortable } from '@dnd-kit/react/sortable';
import type { SessionInfo } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from 'coss-ui/components/menu';
import { SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { EllipsisIcon, PinIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS, AgentIcon } from '../../chat/agent-icon';
import { WithTooltip } from '../../chat/with-tooltip';
import { cn } from '../../lib/cn';
import { repositoryLabel } from '../repository-label';
import { useRelativeTimeLabel } from '../use-relative-time-label';
import {
  ROW_ACTION_CLASS,
  ROW_HOVER_PE_CLASS,
  ROW_HOVER_PE_WIDE_CLASS,
  RowActionsCluster,
} from './row-actions';
import type { ThreadImMenuComponentType } from './thread-im-menu';
import { SESSION_STATUS_DOT_CLASS } from './thread-status';

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
  /** Runtime-backed IM menu items; the ellipsis menu only renders when this is provided. */
  ImMenuComponent?: ThreadImMenuComponentType;
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
  ImMenuComponent,
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
      <WithTooltip tooltip={createdAtLabel}>
        <SidebarMenuButton
          isActive={active}
          onClick={onSelect}
          className={cn(
            // No font-medium when active: IBM Plex Sans lacks CJK, so 500 falls back to
            // PingFang Medium and mixed-script titles read artificially bold.
            'data-[active=true]:font-normal hover:bg-transparent data-[active=true]:hover:bg-sidebar-accent',
            ImMenuComponent ? ROW_HOVER_PE_WIDE_CLASS : ROW_HOVER_PE_CLASS,
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
        </SidebarMenuButton>
      </WithTooltip>
      <RowActionsCluster>
        {ImMenuComponent && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('threadActions')}
              title={t('threadActions')}
              render={<Button className={ROW_ACTION_CLASS} size="icon-xs" variant="ghost" />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56">
              <ImMenuComponent session={session} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          aria-label={pinned ? t('unpinThread') : t('pinThread')}
          title={pinned ? t('unpinThread') : t('pinThread')}
          onClick={onTogglePin}
          className={ROW_ACTION_CLASS}
          size="icon-xs"
          variant="ghost"
        >
          <PinIcon className={cn(pinned && 'fill-current')} />
        </Button>
        <Button
          aria-label={t('closeThread')}
          title={t('closeThread')}
          onClick={onClose}
          className={ROW_ACTION_CLASS}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </RowActionsCluster>
    </SidebarMenuItem>
  );
}
