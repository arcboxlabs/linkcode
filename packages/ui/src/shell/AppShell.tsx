import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import type { ReactElement } from 'react';
import { useTranslations } from 'use-intl';
import { ConversationView, type ConversationViewModel } from '../chat';
import { Composer } from './Composer';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import type { WorkbenchSystemBridge } from './types';

export interface AppShellProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  conversation: ConversationViewModel;
  answeredPermissions: Set<string>;
  systemBridge?: WorkbenchSystemBridge;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
}

/** The full workbench layout: session inbox + conversation stream + composer. */
export function AppShell({
  sessions,
  activeId,
  conversation,
  answeredPermissions,
  systemBridge,
  onSelectSession,
  onStopSession,
  onCreateSession,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
}: AppShellProps): ReactElement {
  const tk = useTranslations('workbench.agentKind');

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
        <div className="min-h-0 flex-1">
          <ConversationView
            conversation={conversation}
            agentKind={active?.kind}
            cwd={active?.cwd}
            answeredPermissions={answeredPermissions}
            pendingPermissions={new Set(conversation.pendingPermissionIds)}
            onRespondPermission={onRespondPermission}
          />
        </div>
        <Composer
          disabled={!activeId}
          isRunning={isRunning}
          availableCommands={conversation.availableCommands}
          currentModeId={conversation.currentModeId}
          onSend={onSendPrompt}
          onStop={onStopTurn}
        />
      </main>
    </div>
  );
}
