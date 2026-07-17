import type { SessionId, SessionInfo, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { AccordionItem, AccordionPanel } from 'coss-ui/components/accordion';
import { SidebarGroup, SidebarGroupAction, SidebarMenu } from 'coss-ui/components/sidebar';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { BranchStatusComponentType } from './branch-status';
import { SectionAccordionTrigger } from './section-header';
import { ShowMoreToggle } from './show-more-toggle';
import type { ThreadImMenuComponentType } from './thread-im-menu';
import { ThreadRow } from './thread-row';

export interface ChatsSectionProps {
  /** The chat workspace's record; `null` before the daemon has provisioned it. */
  workspace: WorkspaceRecord | null;
  /** The subset of the chat workspace's sessions to render, honoring preview truncation. */
  sessions: SessionInfo[];
  /** First load of the session list — renders a row-shaped skeleton instead of the empty hint. */
  isLoading?: boolean;
  hasOverflow: boolean;
  previewExpanded: boolean;
  /** The group key `onTogglePreviewExpanded` is called with. */
  groupKey: string;
  /** The chat group's `collapseKey` — scopes row dragging to this section. */
  sortKey: string;
  activeId: SessionId | null;
  pinnedSessionIds: readonly SessionId[];
  onSelect: (id: SessionId) => void;
  onClose: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  /** Opens the new-session page preselecting the chat workspace. */
  onStartDraft: (workspaceId: WorkspaceId) => void;
  onTogglePreviewExpanded: (groupKey: string) => void;
  ImMenuComponent?: ThreadImMenuComponentType;
  BranchStatusComponent?: BranchStatusComponentType;
}

/** The sidebar's "Chats" section: threads started without picking a workspace, backed by the
 * daemon-owned chat root. Flat list — no group framing or rename/archive menus, since the chat
 * workspace is a fixed system entry rather than user-managed. */
export function ChatsSection({
  workspace,
  sessions,
  isLoading,
  hasOverflow,
  previewExpanded,
  groupKey,
  sortKey,
  activeId,
  pinnedSessionIds,
  onSelect,
  onClose,
  onToggleSessionPinned,
  onStartDraft,
  onTogglePreviewExpanded,
  ImMenuComponent,
  BranchStatusComponent,
}: ChatsSectionProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  return (
    <AccordionItem value="chats" className="border-b-0" render={<SidebarGroup />}>
      <SectionAccordionTrigger>{t('chats')}</SectionAccordionTrigger>
      {workspace && (
        <SidebarGroupAction
          aria-label={t('newChat')}
          title={t('newChat')}
          className="hover:bg-transparent"
          onClick={() => onStartDraft(workspace.workspaceId)}
        >
          <PlusIcon className="size-3.5" />
        </SidebarGroupAction>
      )}
      <AccordionPanel className="pb-0 text-sidebar-foreground">
        {sessions.length > 0 ? (
          <SidebarMenu className="gap-0.5">
            {sessions.map((session, index) => (
              <ThreadRow
                key={session.sessionId}
                active={session.sessionId === activeId}
                pinned={pinnedSessionIds.includes(session.sessionId)}
                sortIndex={index}
                sortGroup={sortKey}
                session={session}
                onSelect={() => onSelect(session.sessionId)}
                onClose={() => onClose(session.sessionId)}
                onTogglePin={() => onToggleSessionPinned(session.sessionId)}
                ImMenuComponent={ImMenuComponent}
                BranchStatusComponent={BranchStatusComponent}
              />
            ))}
            {hasOverflow && (
              <ShowMoreToggle
                expanded={previewExpanded}
                onToggle={() => onTogglePreviewExpanded(groupKey)}
              />
            )}
          </SidebarMenu>
        ) : isLoading ? (
          <div className="flex flex-col gap-0.5">
            {createFixedArray(3).map((i) => (
              <Skeleton key={i} className="h-8 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="px-3 py-3 text-center text-muted-foreground text-sm">
            {t('chatsEmptyHint')}
          </div>
        )}
      </AccordionPanel>
    </AccordionItem>
  );
}
