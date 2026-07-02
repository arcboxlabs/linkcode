import type {
  AgentKind,
  SessionId,
  SessionInfo,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';
import type { BranchStatusComponentType } from './sidebar';
import type { ThreadGroupViewModel } from './threads-view';

export interface ShellFrameProps {
  threadGroups: ThreadGroupViewModel[];
  workspaces: WorkspaceRecord[];
  workspacesLoading?: boolean;
  /** Derived once by the workbench surface; shells consume it instead of re-deriving from the list. */
  activeSession: SessionInfo | null;
  conversation: ConversationViewModel;
  answeredPermissions: Set<string>;
  respondingPermissions: Set<string>;
  header?: React.ReactNode;
  errorMessage?: string | null;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
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
  onRespondPermission: (requestId: string, optionId: string) => void;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  BranchStatusComponent?: BranchStatusComponentType;
  HistoryComponent?: React.ComponentType<{
    cwd: string;
    onImported: (sessionId: SessionId) => void;
  }>;
  onDismissError?: () => void;
  onModelChange?: (model: string) => Promise<void>;
}

export function ShellFrame({
  threadGroups,
  workspaces,
  workspacesLoading,
  activeSession,
  conversation,
  answeredPermissions,
  respondingPermissions,
  header,
  errorMessage,
  onSelectSession,
  onStopSession,
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
  TerminalBlockComponent,
  BranchStatusComponent,
  HistoryComponent,
  onDismissError,
  onModelChange,
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
          activeId={active?.sessionId ?? null}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onStop={onStopSession}
          onCreate={onCreateSession}
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
          onModelChange={onModelChange}
        />
      </main>
    </div>
  );
}
