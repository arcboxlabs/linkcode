import { useSortable } from '@dnd-kit/react/sortable';
import type { SessionInfo } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from 'coss-ui/components/menu';
import { PreviewCard, PreviewCardTrigger } from 'coss-ui/components/preview-card';
import { SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { noop } from 'foxts/noop';
import { ClockIcon, EllipsisIcon, FolderIcon, GitBranchIcon, PinIcon, XIcon } from 'lucide-react';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS, AgentIcon } from '../../chat/agent-icon';
import { cn } from '../../lib/cn';
import { SidePreviewCardPopup } from '../../preview-card-popup';
import { repositoryLabel } from '../../repository-label';
import { useRelativeTimeLabel } from '../use-relative-time-label';
import type { BranchStatusComponentType } from './branch-status';
import {
  RowActionsCluster,
  THREAD_ROW_ACTION_CLASS,
  THREAD_ROW_HOVER_PE_CLASS,
  THREAD_ROW_HOVER_PE_WIDE_CLASS,
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
  /** Runtime-backed branch badge for the preview card; the branch row hides without it. */
  BranchStatusComponent?: BranchStatusComponentType;
}

/** One thread row: ghost agent icon, single-line title, status dot. Full title, relative time,
 * project, and branch live in a hover preview card. */
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
  BranchStatusComponent,
}: ThreadRowProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const agent = AGENT_LABELS[session.kind];
  const title = session.title ?? `${agent} in ${repositoryLabel(session.cwd)}`;
  const createdAtLabel = useRelativeTimeLabel(session.createdAt);
  const [imMenuOpen, setImMenuOpen] = useState(false);
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
      <PreviewCard>
        <PreviewCardTrigger
          closeDelay={0}
          delay={0}
          render={
            <SidebarMenuButton
              isActive={active}
              onClick={onSelect}
              className={cn(
                // No font-medium when active: IBM Plex Sans lacks CJK, so 500 falls back to
                // PingFang Medium and mixed-script titles read artificially bold.
                'h-(--density-thread-row-h) transition-none data-[active=true]:font-normal hover:bg-sidebar-accent data-[active=true]:hover:bg-sidebar-accent',
                ImMenuComponent ? THREAD_ROW_HOVER_PE_WIDE_CLASS : THREAD_ROW_HOVER_PE_CLASS,
                imMenuOpen && 'pe-21 sm:pe-19',
              )}
            />
          }
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
          <OverflowingThreadTitle sessionId={session.sessionId} title={title} />
        </PreviewCardTrigger>
        <SidePreviewCardPopup className="transition-none data-ending-style:scale-100 data-starting-style:scale-100 data-ending-style:opacity-100 data-starting-style:opacity-100">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span>{title}</span>
            <div className="flex flex-col gap-1.5 text-muted-foreground text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <FolderIcon className="size-3.5 shrink-0" />
                <span className="truncate">{repositoryLabel(session.cwd)}</span>
              </span>
              {BranchStatusComponent && (
                <BranchStatusComponent
                  cwd={session.cwd}
                  className="gap-1.5"
                  icon={<GitBranchIcon className="size-3.5 shrink-0" />}
                />
              )}
              <span className="flex items-center gap-1.5">
                <ClockIcon className="size-3.5 shrink-0" />
                <span>{createdAtLabel}</span>
              </span>
            </div>
          </div>
        </SidePreviewCardPopup>
      </PreviewCard>
      <RowActionsCluster>
        {ImMenuComponent && (
          <DropdownMenu onOpenChange={setImMenuOpen} open={imMenuOpen}>
            <DropdownMenuTrigger
              aria-label={t('threadActions')}
              title={t('threadActions')}
              render={
                <Button
                  className={cn(THREAD_ROW_ACTION_CLASS, imMenuOpen && 'opacity-100')}
                  size="icon-xs"
                  variant="ghost"
                />
              }
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
          className={cn(THREAD_ROW_ACTION_CLASS, imMenuOpen && 'opacity-100')}
          size="icon-xs"
          variant="ghost"
        >
          <PinIcon className={cn(pinned && 'fill-current')} />
        </Button>
        <Button
          aria-label={t('closeThread')}
          title={t('closeThread')}
          onClick={onClose}
          className={cn(THREAD_ROW_ACTION_CLASS, imMenuOpen && 'opacity-100')}
          size="icon-xs"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </RowActionsCluster>
    </SidebarMenuItem>
  );
}

function OverflowingThreadTitle({
  sessionId,
  title,
}: {
  sessionId: string;
  title: string;
}): React.ReactNode {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const subscribeToSize = useCallback((onChange: () => void): (() => void) => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text || typeof ResizeObserver === 'undefined') return noop;

    const observer = new ResizeObserver(onChange);
    observer.observe(container);
    observer.observe(text);
    return () => observer.disconnect();
  }, []);
  const readOverflow = useCallback((): number => {
    const container = containerRef.current;
    const text = textRef.current;
    return container && text ? Math.max(0, text.scrollWidth - container.clientWidth) : 0;
  }, []);
  const overflow = useSyncExternalStore(subscribeToSize, readOverflow, () => 0);

  return (
    <span
      className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap group-hover/menu-item:text-clip"
      data-thread-title={sessionId}
      ref={containerRef}
    >
      <span
        className={cn(
          'inline-block',
          overflow > 0 &&
            'motion-safe:group-hover/menu-item:translate-x-[var(--thread-title-overflow)] motion-safe:group-hover/menu-item:transition-transform motion-safe:group-hover/menu-item:[transition-duration:var(--thread-title-scroll-duration)] motion-safe:group-hover/menu-item:ease-linear',
        )}
        ref={textRef}
        style={
          {
            '--thread-title-overflow': `-${overflow}px`,
            // Scale with hidden width so long titles move at a consistent, readable speed.
            '--thread-title-scroll-duration': `${Math.max(1800, overflow * 30)}ms`,
          } as React.CSSProperties
        }
      >
        {title}
      </span>
    </span>
  );
}
