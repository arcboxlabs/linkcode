import type {
  EffortLevel,
  SessionId,
  SessionInfo,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import type { PermissionDecision } from '../chat/conversation-prompts';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import type { NewSessionDraft, NewSessionSubmission } from './new-session-surface';
import { NewSessionSurface } from './new-session-surface';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';
import type { BranchStatusComponentType } from './sidebar';
import type { ThreadGroupViewModel } from './threads-view';

export interface ShellFrameProps {
  threadGroups: ThreadGroupViewModel[];
  workspaces: WorkspaceRecord[];
  workspacesLoading?: boolean;
  /** The daemon-owned chat workspace, offered by the new-session page's picker as "Chat". */
  chatWorkspace: WorkspaceRecord | null;
  /** Derived once by the workbench surface; shells consume it instead of re-deriving from the list. */
  activeSession: SessionInfo | null;
  /** Non-null while the new-session page is up — it replaces the conversation column. */
  draft: NewSessionDraft | null;
  conversation: ConversationViewModel;
  permissionDecisions: ReadonlyMap<string, PermissionDecision>;
  respondingPermissions: ReadonlySet<string>;
  header?: React.ReactNode;
  errorMessage?: string | null;
  /** Threads pinned to the top of their sidebar group, in pin order. */
  pinnedSessionIds: readonly SessionId[];
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onToggleSessionPinned: (id: SessionId) => void;
  /** Persists a group drag: the full new project-group order, as `collapseKey`s. */
  onReorderGroups: (orderedCollapseKeys: string[]) => void;
  /** Persists a thread drag within a group: `activeId` landed before/after `overId`. */
  onReorderThreads: (
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ) => void;
  /** Opens the new-session page, optionally preselecting a workspace. */
  onStartDraft: (workspaceId?: WorkspaceId) => void;
  /** Starts the drafted session and sends its first prompt; rejection keeps the page up. */
  onSubmitDraft: (submission: NewSessionSubmission) => Promise<void>;
  onImportSession?: (sessionId: SessionId) => void;
  /** Registers a directory as a workspace; every shell wires this into the sidebar's Add workspace row. */
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => Promise<void>;
  onArchiveWorkspace: (workspaceId: WorkspaceId) => Promise<void>;
  onToggleGroupCollapsed: (collapseKey: string) => void;
  onTogglePreviewExpanded: (groupKey: string) => void;
  onToggleImportHistory: (groupKey: string) => void;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  BranchStatusComponent?: BranchStatusComponentType;
  HistoryComponent?: React.ComponentType<{
    cwd: string;
    onImported: (sessionId: SessionId) => void;
  }>;
  onDismissError?: () => void;
  onModeChange?: (modeId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
}

export function ShellFrame({
  threadGroups,
  workspaces,
  workspacesLoading,
  chatWorkspace,
  activeSession,
  draft,
  conversation,
  permissionDecisions,
  respondingPermissions,
  header,
  errorMessage,
  pinnedSessionIds,
  onSelectSession,
  onStopSession,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onStartDraft,
  onSubmitDraft,
  onImportSession,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onTogglePreviewExpanded,
  onToggleImportHistory,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  TerminalBlockComponent,
  BranchStatusComponent,
  HistoryComponent,
  onDismissError,
  onModeChange,
  onModelChange,
  onEffortChange,
}: ShellFrameProps): React.ReactNode {
  const active = activeSession;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <SessionSidebar
          threadGroups={threadGroups}
          workspacesLoading={workspacesLoading}
          activeId={active?.sessionId ?? null}
          pinnedSessionIds={pinnedSessionIds}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onStop={onStopSession}
          onToggleSessionPinned={onToggleSessionPinned}
          onReorderGroups={onReorderGroups}
          onReorderThreads={onReorderThreads}
          onStartDraft={onStartDraft}
          onImportSession={onImportSession}
          onRegisterWorkspace={onRegisterWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onArchiveWorkspace={onArchiveWorkspace}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onTogglePreviewExpanded={onTogglePreviewExpanded}
          onToggleImportHistory={onToggleImportHistory}
          BranchStatusComponent={BranchStatusComponent}
          HistoryComponent={HistoryComponent}
        />
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />
        {draft ? (
          // Keyed per entry point so opening from another group resets the page's picks.
          <NewSessionSurface
            key={draft.initialWorkspaceId ?? 'default'}
            className="min-h-0 flex-1"
            draft={draft}
            workspaces={workspaces}
            chatWorkspace={chatWorkspace}
            onSubmit={onSubmitDraft}
            onRegisterWorkspace={onRegisterWorkspace}
          />
        ) : (
          // Keyed per session: switching resets the composer draft and scroll without touching the shell.
          <ConversationSurface
            key={active?.sessionId ?? 'no-active-session'}
            className="min-h-0 flex-1"
            conversation={conversation}
            agentKind={active?.kind}
            agentLabel={active ? active.kind : undefined}
            disabled={!active || active.status === 'stopped'}
            isRunning={isRunning}
            cwd={active?.cwd}
            permissionDecisions={permissionDecisions}
            respondingPermissions={respondingPermissions}
            TerminalBlockComponent={TerminalBlockComponent}
            onSendPrompt={onSendPrompt}
            onStopTurn={onStopTurn}
            onRespondPermission={onRespondPermission}
            onModeChange={onModeChange}
            onModelChange={onModelChange}
            onEffortChange={onEffortChange}
          />
        )}
      </main>
    </div>
  );
}
