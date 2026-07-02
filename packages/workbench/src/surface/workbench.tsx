import { useConversation, useTerminalOutput } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';
import { cancelTurn, promptText, respondPermission, setModel } from '@linkcode/sdk';
import { TerminalBlock } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useMutation } from '../runtime/tayori';
import { RuntimeBranchStatus } from '../sidebar/branch-status';
import { groupThreadsByWorkspace } from '../sidebar/group-threads';
import { RuntimeWorkspaceHistory } from '../sidebar/workspace-history';
import { useWorkspaces } from '../workspace/hooks';
import type { WorkbenchShellComponent } from './shell';
import { DefaultWorkbenchShell } from './shell';
import type { WorkbenchSessions } from './use-workbench-sessions';
import { useWorkbenchSessions } from './use-workbench-sessions';

export interface WorkbenchProps {
  shellComponent?: WorkbenchShellComponent;
}

/**
 * The workbench feature surface: session inbox + conversation stream + composer.
 *
 * It assumes the data plane is already mounted above it (transport client,
 * `TayoriProvider`, `SWRConfig`, and `LinkCodeProvider`) — see `WorkbenchProviders`.
 * Wrap it in `WorkbenchProviders` (at a layout, or inline) and mount it as a
 * routed feature page.
 */
export function Workbench({
  shellComponent: ShellComponent = DefaultWorkbenchShell,
}: WorkbenchProps): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  function handleError(err: unknown): void {
    setErrorMessage(extractErrorMessage(err));
  }

  const sessions = useWorkbenchSessions(handleError);
  const conversation = useConversation(sessions.activeId);

  return (
    <WorkbenchSessionSurface
      key={sessions.activeId ?? 'no-active-session'}
      sessions={sessions}
      conversation={conversation}
      errorMessage={errorMessage}
      ShellComponent={ShellComponent}
      onClearError={() => setErrorMessage(null)}
      onError={handleError}
    />
  );
}

interface WorkbenchSessionSurfaceProps {
  sessions: WorkbenchSessions;
  conversation: ReturnType<typeof useConversation>;
  errorMessage: string | null;
  ShellComponent: WorkbenchShellComponent;
  onClearError: () => void;
  onError: (err: unknown) => void;
}

function WorkbenchSessionSurface({
  sessions,
  conversation,
  errorMessage,
  ShellComponent,
  onClearError,
  onError,
}: WorkbenchSessionSurfaceProps): React.ReactNode {
  const tk = useTranslations('workbench.agentKind');
  const promptMutation = useMutation(promptText, { onError });
  const cancelMutation = useMutation(cancelTurn, { onError });
  const permissionMutation = useMutation(respondPermission, { onError });
  const modelMutation = useMutation(setModel, { onError });
  const [answered, addAnswered] = useSet<string>();
  const [responding, addResponding, removeResponding] = useSet<string>();
  const active = sessions.active;
  const { data: workspaces, isLoading: workspacesLoading } = useWorkspaces();
  const threadGroups = useMemo(
    () => groupThreadsByWorkspace(sessions.sessions, workspaces ?? []),
    [sessions.sessions, workspaces],
  );

  function handleSend(text: string): void {
    if (!sessions.activeId) return;
    onClearError();
    void promptMutation.trigger({ sessionId: sessions.activeId, text }).catch(noop);
  }

  function handleStopTurn(): void {
    if (!sessions.activeId) return;
    onClearError();
    void cancelMutation.trigger({ sessionId: sessions.activeId }).catch(noop);
  }

  function handleModelChange(model: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Let the rejection propagate: the composer awaits it to decide whether to reflect the pick.
    // onError (wired into modelMutation above) still reports the failure via the error banner.
    return modelMutation.trigger({ sessionId: sessions.activeId, model }).then(noop);
  }

  function handleImportedSession(sessionId: SessionId): void {
    sessions.refresh();
    sessions.select(sessionId);
  }

  function handleRespond(requestId: string, optionId: string): void {
    if (!sessions.activeId) return;
    onClearError();
    addResponding(requestId);
    void permissionMutation
      .trigger({
        sessionId: sessions.activeId,
        requestId,
        outcome: { outcome: 'selected', optionId },
      })
      .then(() => {
        addAnswered(requestId);
      })
      .catch(noop)
      .finally(() => {
        removeResponding(requestId);
      });
  }

  return (
    <ShellComponent
      sessions={sessions.sessions}
      threadGroups={threadGroups}
      workspaces={workspaces ?? []}
      workspacesLoading={workspacesLoading}
      activeSession={active}
      conversation={conversation}
      answeredPermissions={answered}
      respondingPermissions={responding}
      header={{
        title: active ? tk(active.kind) : 'Link Code',
        subtitle: active?.cwd,
        usage: conversation.usage,
      }}
      errorMessage={errorMessage}
      onSelectSession={sessions.select}
      onStopSession={sessions.stop}
      onCreateSession={sessions.create}
      onImportSession={handleImportedSession}
      onSendPrompt={handleSend}
      onStopTurn={handleStopTurn}
      onRespondPermission={handleRespond}
      TerminalBlockComponent={RuntimeTerminalBlock}
      BranchStatusComponent={RuntimeBranchStatus}
      HistoryComponent={RuntimeWorkspaceHistory}
      onDismissError={onClearError}
      onModelChange={handleModelChange}
    />
  );
}

function RuntimeTerminalBlock({ terminalId }: { terminalId: string }): React.ReactNode {
  const output = useTerminalOutput(terminalId);
  return <TerminalBlock terminalId={terminalId} output={output} />;
}
