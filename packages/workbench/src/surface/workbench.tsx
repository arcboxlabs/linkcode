import type { Conversation } from '@linkcode/client-core';
import { useTerminalOutput } from '@linkcode/client-core';
import type { SessionId, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import {
  archiveWorkspace,
  cancelTurn,
  promptText,
  registerWorkspace,
  respondPermission,
  setModel,
  updateWorkspace,
} from '@linkcode/sdk';
import type { ThreadGroupViewModel } from '@linkcode/ui';
import { TerminalBlock } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useMutation } from '../runtime/tayori';
import { RuntimeBranchStatus } from '../sidebar/branch-status';
import { useSidebarGroupCollapseStore } from '../sidebar/collapse-store';
import { groupThreadsByWorkspace } from '../sidebar/group-threads';
import { selectVisibleSessions } from '../sidebar/visible-sessions';
import { RuntimeWorkspaceHistory } from '../sidebar/workspace-history';
import { useWorkspaces } from '../workspace/hooks';
import type { WorkbenchShellComponent } from './shell';
import { DefaultWorkbenchShell } from './shell';
import { useSeededConversation } from './use-seeded-conversation';
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
  const conversation = useSeededConversation(sessions.active, handleError);

  // Deliberately NOT keyed by the active session: the surface hosts the whole shell (chrome,
  // sidebar, panels, terminals), which must stay permanently mounted across session switches —
  // remounting it flashes the entire window. Per-session UI reset happens at the conversation
  // column (the shells key their ConversationSurface), and the permission sets below survive
  // switches safely because adapter requestIds are globally unique.
  return (
    <WorkbenchSessionSurface
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
  conversation: Conversation;
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
  const {
    data: workspaces,
    isLoading: workspacesLoading,
    mutate: refreshWorkspaces,
  } = useWorkspaces();
  const registerWorkspaceMutation = useMutation(registerWorkspace);
  const updateWorkspaceMutation = useMutation(updateWorkspace);
  const archiveWorkspaceMutation = useMutation(archiveWorkspace);
  const collapsedKeys = useSidebarGroupCollapseStore((state) => state.collapsedKeys);
  const toggleGroupCollapsed = useSidebarGroupCollapseStore((state) => state.toggleCollapsed);
  const [previewExpandedKeys, addPreviewExpanded, removePreviewExpanded] = useSet<string>();
  const [historyOpenKeys, addHistoryOpen, removeHistoryOpen] = useSet<string>();
  const threadGroups = useMemo<ThreadGroupViewModel[]>(() => {
    const groups = groupThreadsByWorkspace(sessions.sessions, workspaces ?? []);
    return groups.map((group) => {
      const collapsed = collapsedKeys.includes(group.collapseKey);
      const previewExpanded = previewExpandedKeys.has(group.key);
      const historyOpen = historyOpenKeys.has(group.key);
      const { sessions: visibleSessions, hasOverflow } = selectVisibleSessions(group.sessions, {
        collapsed,
        expanded: previewExpanded,
        activeId: sessions.activeId,
      });
      return { ...group, visibleSessions, hasOverflow, collapsed, previewExpanded, historyOpen };
    });
  }, [
    sessions.sessions,
    sessions.activeId,
    workspaces,
    collapsedKeys,
    previewExpandedKeys,
    historyOpenKeys,
  ]);

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

  function handleRegisterWorkspace(cwd: string): Promise<WorkspaceRecord> {
    return registerWorkspaceMutation.trigger({ cwd }).then((workspace) => {
      void refreshWorkspaces();
      return workspace;
    });
  }

  function handleRenameWorkspace(workspaceId: WorkspaceId, name: string): Promise<void> {
    // Let the rejection propagate: the group header awaits it to show an inline error.
    return updateWorkspaceMutation.trigger({ workspaceId, name }).then(() => {
      void refreshWorkspaces();
    });
  }

  function handleArchiveWorkspace(workspaceId: WorkspaceId): Promise<void> {
    return archiveWorkspaceMutation.trigger({ workspaceId }).then(() => {
      void refreshWorkspaces();
    });
  }

  function handleTogglePreviewExpanded(groupKey: string): void {
    if (previewExpandedKeys.has(groupKey)) removePreviewExpanded(groupKey);
    else addPreviewExpanded(groupKey);
  }

  function handleToggleImportHistory(groupKey: string): void {
    if (historyOpenKeys.has(groupKey)) removeHistoryOpen(groupKey);
    else addHistoryOpen(groupKey);
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
      onRegisterWorkspace={handleRegisterWorkspace}
      onRenameWorkspace={handleRenameWorkspace}
      onArchiveWorkspace={handleArchiveWorkspace}
      onToggleGroupCollapsed={toggleGroupCollapsed}
      onTogglePreviewExpanded={handleTogglePreviewExpanded}
      onToggleImportHistory={handleToggleImportHistory}
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
