import { useConversation, useLinkCodeClient, useSessions } from '@linkcode/client-core';
import type { AgentKind, SessionId } from '@linkcode/schema';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { ConversationView } from '../chat';
import { Composer } from './Composer';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import type { WorkbenchSystemBridge } from './types';

export interface AppShellProps {
  systemBridge?: WorkbenchSystemBridge;
}

/** The full workbench layout: session inbox + conversation stream + composer, wired to the data layer. */
export function AppShell({ systemBridge }: AppShellProps): ReactElement {
  const client = useLinkCodeClient();
  const tk = useTranslations('workbench.agentKind');
  const sessions = useSessions();
  const conversation = useConversation(sessions.activeId);
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear answered permissions on session switch
  useEffect(() => {
    setAnswered(new Set());
  }, [sessions.activeId]);

  const active = sessions.sessions.find((s) => s.sessionId === sessions.activeId) ?? null;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';

  function handleSend(text: string): void {
    if (sessions.activeId) client.promptText(sessions.activeId, text);
  }
  function handleStop(): void {
    if (sessions.activeId) client.cancel(sessions.activeId);
  }
  function handleRespond(requestId: string, optionId: string): void {
    if (!sessions.activeId) return;
    client.respondPermission(sessions.activeId, requestId, { outcome: 'selected', optionId });
    setAnswered((prev) => new Set(prev).add(requestId));
  }
  function handleCreate(opts: { kind: AgentKind; cwd: string }): void {
    void sessions.create(opts);
  }

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions.sessions}
        activeId={sessions.activeId}
        onSelect={(id: SessionId) => sessions.select(id)}
        onStop={(id: SessionId) => sessions.stop(id)}
        onCreate={handleCreate}
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
            answeredPermissions={answered}
            pendingPermissions={new Set(conversation.pendingPermissionIds)}
            onRespondPermission={handleRespond}
          />
        </div>
        <Composer
          disabled={!sessions.activeId}
          isRunning={isRunning}
          availableCommands={conversation.availableCommands}
          currentModeId={conversation.currentModeId}
          onSend={handleSend}
          onStop={handleStop}
        />
      </main>
    </div>
  );
}
