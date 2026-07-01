import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';

export interface ShellFrameProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  conversation: ConversationViewModel;
  answeredPermissions: Set<string>;
  respondingPermissions: Set<string>;
  header?: React.ReactNode;
  errorMessage?: string | null;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onDismissError?: () => void;
  onModelChange?: (model: string) => Promise<void>;
}

export function ShellFrame({
  sessions,
  activeId,
  conversation,
  answeredPermissions,
  respondingPermissions,
  header,
  errorMessage,
  onSelectSession,
  onStopSession,
  onCreateSession,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  TerminalBlockComponent,
  onDismissError,
  onModelChange,
}: ShellFrameProps): React.ReactNode {
  const active = sessionById(sessions, activeId);
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';
  const fallbackCwd = active?.cwd ?? sessions.at(0)?.cwd ?? '/';

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <SessionSidebar
          sessions={sessions}
          activeId={activeId}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onStop={onStopSession}
          onCreate={(kind) => onCreateSession({ kind, cwd: fallbackCwd })}
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
          disabled={!activeId}
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

function sessionById(
  sessions: readonly SessionInfo[],
  sessionId: SessionId | null,
): SessionInfo | null {
  if (!sessionId) return null;
  for (const session of sessions) {
    if (session.sessionId === sessionId) return session;
  }
  return null;
}
