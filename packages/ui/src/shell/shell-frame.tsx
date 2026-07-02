import type { AgentKind, SessionId, SessionInfo, WorkspaceRecord } from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';
import type { BranchStatusComponentType, ThreadGroupViewModel } from './threads-view';

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
          BranchStatusComponent={BranchStatusComponent}
          HistoryComponent={HistoryComponent}
        />
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />
        <ConversationSurface
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
