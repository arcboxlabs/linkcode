import type { AgentKind, SessionId, SessionInfo, WorkspaceRecord } from '@linkcode/schema';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AgentKindList } from './agent-kind-list';
import { ShowMoreToggle } from './show-more-toggle';
import { ThreadRow } from './thread-row';

export interface ChatsSectionProps {
  /** The chat workspace's record; `null` before the daemon has provisioned it. */
  workspace: WorkspaceRecord | null;
  /** The subset of the chat workspace's sessions to render, honoring preview truncation. */
  sessions: SessionInfo[];
  hasOverflow: boolean;
  previewExpanded: boolean;
  /** The group key `onTogglePreviewExpanded` is called with. */
  groupKey: string;
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
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
  hasOverflow,
  previewExpanded,
  groupKey,
  activeId,
  onSelect,
  onStop,
  onCreate,
  onTogglePreviewExpanded,
}: ChatsSectionProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const [newChatOpen, setNewChatOpen] = useState(false);

  return (
    <section>
      <div className="flex h-7 items-center gap-1.5 px-[var(--lc-sidebar-edge,0.5rem)]">
        <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground text-xs">
          {t('chats')}
        </span>
        {workspace && (
          <Popover open={newChatOpen} onOpenChange={setNewChatOpen}>
            <PopoverTrigger
              aria-label={t('newChat')}
              title={t('newChat')}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PlusIcon className="size-3.5" />
            </PopoverTrigger>
            <PopoverPopup align="start" side="right" sideOffset={8} className="w-56 p-0">
              <AgentKindList
                onPick={(pickedKind) => {
                  setNewChatOpen(false);
                  onCreate({ kind: pickedKind, cwd: workspace.cwd });
                }}
              />
            </PopoverPopup>
          </Popover>
        )}
      </div>
      {sessions.length > 0 ? (
        <div className="space-y-0.5">
          {sessions.map((session) => (
            <ThreadRow
              key={session.sessionId}
              active={session.sessionId === activeId}
              session={session}
              onSelect={() => onSelect(session.sessionId)}
              onStop={() => onStop(session.sessionId)}
            />
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
