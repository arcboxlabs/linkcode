import type {
  AgentKind,
  EffortLevel,
  SessionId,
  SessionInfo,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';
import type { ThreadGroupActions, ThreadGroupState } from './sidebar';
import type { ThreadGroupViewModel } from './threads-view';

/** Session/group action field names this shell exposes under its own naming (`onSelectSession`, etc). */
type RenamedThreadGroupActions = 'onSelect' | 'onStop' | 'onCreate';

export interface ShellFrameProps
  extends Pick<ThreadGroupActions, Exclude<keyof ThreadGroupActions, RenamedThreadGroupActions>>,
    Pick<ThreadGroupState, 'pinnedSessionIds'> {
  threadGroups: ThreadGroupViewModel[];
  workspaces: WorkspaceRecord[];
  workspacesLoading?: boolean;
  /** First load of the session list — the sidebar's "Chats" section shows a skeleton, not the empty hint. */
  sessionsLoading?: boolean;
  /** Derived once by the workbench surface; shells consume it instead of re-deriving from the list. */
  activeSession: SessionInfo | null;
  conversation: ConversationViewModel;
  answeredPermissions: Set<string>;
  respondingPermissions: Set<string>;
  header?: React.ReactNode;
  errorMessage?: string | null;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  /** Persists a group drag: the full new project-group order, as `collapseKey`s. */
  onReorderGroups: (orderedCollapseKeys: string[]) => void;
  /** Persists a thread drag within a group: `activeId` landed before/after `overId`. */
  onReorderThreads: (
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
  /** Registers a directory as a workspace; every shell wires this into the sidebar's Add workspace row. */
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
  /** Opens the command palette — the sidebar Search entry stays disabled without it. */
  onOpenSearch?: () => void;
  /** Platform-formatted hint next to the Search entry, e.g. `⌘K`. */
  searchShortcut?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onDismissError?: () => void;
  onModeChange?: (modeId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
}

export function ShellFrame({
  threadGroups,
  workspaces,
  workspacesLoading,
  sessionsLoading,
  activeSession,
  conversation,
  answeredPermissions,
  respondingPermissions,
  header,
  errorMessage,
  pinnedSessionIds,
  onSelectSession,
  onStopSession,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onCreateSession,
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
  onOpenSearch,
  searchShortcut,
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
          workspaces={workspaces}
          workspacesLoading={workspacesLoading}
          sessionsLoading={sessionsLoading}
          activeId={active?.sessionId ?? null}
          pinnedSessionIds={pinnedSessionIds}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onStop={onStopSession}
          onToggleSessionPinned={onToggleSessionPinned}
          onReorderGroups={onReorderGroups}
          onReorderThreads={onReorderThreads}
          onCreate={onCreateSession}
          onImportSession={onImportSession}
          onRegisterWorkspace={onRegisterWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onArchiveWorkspace={onArchiveWorkspace}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onTogglePreviewExpanded={onTogglePreviewExpanded}
          onToggleImportHistory={onToggleImportHistory}
          onOpenSearch={onOpenSearch}
          searchShortcut={searchShortcut}
          BranchStatusComponent={BranchStatusComponent}
          HistoryComponent={HistoryComponent}
        />
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />
        {/* Keyed per session: switching resets the composer draft and scroll without touching the shell. */}
        <ConversationSurface
          key={active?.sessionId ?? 'no-active-session'}
          className="min-h-0 flex-1"
          conversation={conversation}
          agentKind={active?.kind}
          agentLabel={active ? active.kind : undefined}
          disabled={!active || active.status === 'stopped'}
          isRunning={isRunning}
          cwd={active?.cwd}
          answeredPermissions={answeredPermissions}
          respondingPermissions={respondingPermissions}
          TerminalBlockComponent={TerminalBlockComponent}
          onSendPrompt={onSendPrompt}
          onStopTurn={onStopTurn}
          onRespondPermission={onRespondPermission}
          onModeChange={onModeChange}
          onModelChange={onModelChange}
          onEffortChange={onEffortChange}
        />
      </main>
    </div>
  );
}
