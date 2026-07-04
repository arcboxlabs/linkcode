import type { SessionId, SessionInfo, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { ShowMoreToggle } from './show-more-toggle';
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
}

/**
 * The sidebar's "Chats" section: threads started without picking a workspace, backed by the
 * daemon-owned chat root directory. Threads render as a flat list — no group-header framing,
 * branch badge, or rename/archive/import-history menu, since the chat workspace is a fixed
 * system entry rather than something the user manages.
 */
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
}: ChatsSectionProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');

  return (
    <section>
      <div className="flex h-7 items-center gap-1.5 px-[var(--lc-sidebar-edge,0.5rem)]">
        <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground text-xs">
          {t('chats')}
        </span>
        {workspace && (
          <button
            type="button"
            aria-label={t('newChat')}
            title={t('newChat')}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onStartDraft(workspace.workspaceId)}
          >
            <PlusIcon className="size-3.5" />
          </button>
        )}
      </div>
      {sessions.length > 0 ? (
        <div className="space-y-0.5">
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
            />
          ))}
        </div>
      ) : isLoading ? (
        <div className="space-y-0.5">
          {createFixedArray(3).map((i) => (
            <Skeleton key={i} className="h-7 w-full rounded-md" />
          ))}
        </div>
      ) : (
        <div className="px-[calc(var(--lc-sidebar-edge,0.5rem)+0.25rem)] py-3 text-center text-muted-foreground text-xs">
          {t('chatsEmptyHint')}
        </div>
      )}
      {hasOverflow && (
        <ShowMoreToggle
          expanded={previewExpanded}
          onToggle={() => onTogglePreviewExpanded(groupKey)}
        />
      )}
    </section>
  );
}
