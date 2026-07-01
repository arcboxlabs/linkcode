import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ConversationViewModel } from '../chat';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';
import { WorkbenchConversationSurface } from './workbench-conversation-surface';

export interface WorkbenchFrameProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  conversation: ConversationViewModel;
  answeredPermissions: Set<string>;
  respondingPermissions: Set<string>;
  header?: ReactNode;
  errorMessage?: string | null;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
  onDismissError?: () => void;
  onModelChange?: (model: string) => Promise<void>;
}

export function WorkbenchFrame({
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
  onDismissError,
  onModelChange,
}: WorkbenchFrameProps): ReactNode {
  const active = sessions.find((s) => s.sessionId === activeId) ?? null;
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
        {errorMessage && (
          <div className="border-border border-b px-4 py-2">
            <Alert variant="error" className="rounded-md py-2">
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
              {onDismissError && (
                <AlertAction>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dismiss"
                    onClick={onDismissError}
                  >
                    <XIcon />
                  </Button>
                </AlertAction>
              )}
            </Alert>
          </div>
        )}
        <WorkbenchConversationSurface
          className="min-h-0 flex-1"
          conversation={conversation}
          agentKind={active?.kind}
          agentLabel={active ? active.kind : undefined}
          disabled={!activeId}
          isRunning={isRunning}
          cwd={active?.cwd}
          answeredPermissions={answeredPermissions}
          respondingPermissions={respondingPermissions}
          onSendPrompt={onSendPrompt}
          onStopTurn={onStopTurn}
          onRespondPermission={onRespondPermission}
          onModelChange={onModelChange}
        />
      </main>
    </div>
  );
}
