import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';

export interface ShellFrameProps {
  sessions: SessionInfo[];
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
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onDismissError?: () => void;
  onModelChange?: (model: string) => Promise<void>;
}

export function ShellFrame({
  sessions,
  activeSession,
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
  const active = activeSession;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';
  const fallbackCwd = active?.cwd ?? sessions.at(0)?.cwd ?? '/';

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <SessionSidebar
          sessions={sessions}
          activeId={active?.sessionId ?? null}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onStop={onStopSession}
          onCreate={(kind) => onCreateSession({ kind, cwd: fallbackCwd })}
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
