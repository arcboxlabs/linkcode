import { useConversation, useTerminalOutput } from '@linkcode/client-core';
import type { SessionInfo } from '@linkcode/schema';
import { cancelTurn, promptText, respondPermission, setModel } from '@linkcode/sdk';
import { ConversationSurface, ErrorBanner, TerminalBlock } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useMutation } from '../runtime/tayori';
import type { WorkbenchShellComponent } from './shell';
import { DefaultWorkbenchShell } from './shell';
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
 *
 * The shell mounts once and never remounts on session switch; only the keyed
 * `WorkbenchSessionView` in its `main` slot does.
 */
export function Workbench({
  shellComponent: ShellComponent = DefaultWorkbenchShell,
}: WorkbenchProps): React.ReactNode {
  const tk = useTranslations('workbench.agentKind');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  function handleError(err: unknown): void {
    setErrorMessage(extractErrorMessage(err));
  }

  const sessions = useWorkbenchSessions(handleError);
  const conversation = useConversation(sessions.activeId);
  const active = sessions.active;

  return (
    <ShellComponent
      sessions={sessions.sessions}
      activeSession={active}
      header={{
        title: active ? tk(active.kind) : 'Link Code',
        subtitle: active?.cwd,
        usage: conversation.usage,
      }}
      pendingPermissionCount={conversation.pendingPermissionIds.length}
      onSelectSession={sessions.select}
      onStopSession={sessions.stop}
      onCreateSession={sessions.create}
      main={
        <WorkbenchSessionView
          key={sessions.activeId ?? 'no-active-session'}
          session={active}
          conversation={conversation}
          errorMessage={errorMessage}
          onClearError={() => setErrorMessage(null)}
          onError={handleError}
        />
      }
    />
  );
}

interface WorkbenchSessionViewProps {
  session: SessionInfo | null;
  conversation: ReturnType<typeof useConversation>;
  errorMessage: string | null;
  onClearError: () => void;
  onError: (err: unknown) => void;
}

/**
 * The session-scoped view: conversation stream + composer + permission responses. Keyed by session
 * in `Workbench`, so per-session state (composer draft, scroll, the permission sets below) resets
 * on switch while the shell above stays mounted.
 */
function WorkbenchSessionView({
  session,
  conversation,
  errorMessage,
  onClearError,
  onError,
}: WorkbenchSessionViewProps): React.ReactNode {
  const promptMutation = useMutation(promptText, { onError });
  const cancelMutation = useMutation(cancelTurn, { onError });
  const permissionMutation = useMutation(respondPermission, { onError });
  const modelMutation = useMutation(setModel, { onError });
  const [answered, addAnswered] = useSet<string>();
  const [responding, addResponding, removeResponding] = useSet<string>();
  const sessionId = session?.sessionId ?? null;

  function handleSend(text: string): void {
    if (!sessionId) return;
    onClearError();
    void promptMutation.trigger({ sessionId, text }).catch(noop);
  }

  function handleStopTurn(): void {
    if (!sessionId) return;
    onClearError();
    void cancelMutation.trigger({ sessionId }).catch(noop);
  }

  function handleModelChange(model: string): Promise<void> {
    if (!sessionId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Let the rejection propagate: the composer awaits it to decide whether to reflect the pick.
    // onError (wired into modelMutation above) still reports the failure via the error banner.
    return modelMutation.trigger({ sessionId, model }).then(noop);
  }

  function handleRespond(requestId: string, optionId: string): void {
    if (!sessionId) return;
    onClearError();
    addResponding(requestId);
    void permissionMutation
      .trigger({
        sessionId,
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

  const isRunning = conversation.status === 'running' || conversation.status === 'starting';

  return (
    <ConversationSurface
      conversation={conversation}
      agentKind={session?.kind}
      agentLabel={session?.kind}
      cwd={session?.cwd}
      answeredPermissions={answered}
      respondingPermissions={responding}
      disabled={!session || session.status === 'stopped'}
      isRunning={isRunning}
      topContent={<ErrorBanner errorMessage={errorMessage} onDismissError={onClearError} />}
      TerminalBlockComponent={RuntimeTerminalBlock}
      onSendPrompt={handleSend}
      onStopTurn={handleStopTurn}
      onRespondPermission={handleRespond}
      onModelChange={handleModelChange}
    />
  );
}

function RuntimeTerminalBlock({ terminalId }: { terminalId: string }): React.ReactNode {
  const output = useTerminalOutput(terminalId);
  return <TerminalBlock terminalId={terminalId} output={output} />;
}
