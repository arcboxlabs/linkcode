import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { ConversationView } from '../chat';
import type { ConversationViewModel } from '../chat';
import { Composer } from './composer';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';
import type { WorkbenchSystemBridge } from './types';

export interface AppShellProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  conversation: ConversationViewModel;
  answeredPermissions: Set<string>;
  respondingPermissions: Set<string>;
  errorMessage?: string | null;
  systemBridge?: WorkbenchSystemBridge;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
  onDismissError?: () => void;
}

/** The full workbench layout: session inbox + conversation stream + composer. */
export function AppShell({
  sessions,
  activeId,
  conversation,
  answeredPermissions,
  respondingPermissions,
  errorMessage,
  systemBridge,
  onSelectSession,
  onStopSession,
  onCreateSession,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onDismissError,
}: AppShellProps): ReactNode {
  const tk = useTranslations('workbench.agentKind');
  const te = useTranslations('workbench.error');

  const active = sessions.find((s) => s.sessionId === activeId) ?? null;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={onSelectSession}
        onStop={onStopSession}
        onCreate={onCreateSession}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={active ? tk(active.kind) : 'Link Code'}
          subtitle={active?.cwd}
          usage={conversation.usage}
          systemBridge={systemBridge}
        />
        {errorMessage && (
          <div className="border-b border-border px-4 py-2">
            <Alert variant="error" className="rounded-lg py-2">
              <AlertTitle>{te('title')}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
              {onDismissError && (
                <AlertAction>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={te('dismiss')}
                    onClick={onDismissError}
                  >
                    <XIcon />
                  </Button>
                </AlertAction>
              )}
            </Alert>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ConversationView
            conversation={conversation}
            agentKind={active?.kind}
            cwd={active?.cwd}
            answeredPermissions={answeredPermissions}
            respondingPermissions={respondingPermissions}
            pendingPermissions={new Set(conversation.pendingPermissionIds)}
            onRespondPermission={onRespondPermission}
          />
        </div>
        <Composer
          disabled={!activeId}
          isRunning={isRunning}
          currentModeId={conversation.currentModeId}
          onSend={onSendPrompt}
          onStop={onStopTurn}
        />
      </main>
    </div>
  );
}
