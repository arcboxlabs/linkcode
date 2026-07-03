import type { Conversation } from '@linkcode/client-core';
import { useTerminalOutput } from '@linkcode/client-core';
import type { EffortLevel, SessionId, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { workspaceKind } from '@linkcode/schema';
import {
  archiveWorkspace,
  cancelTurn,
  promptText,
  registerWorkspace,
  respondPermission,
  sendInput,
  setEffort,
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
import { useSidebarOrderStore } from '../sidebar/order-store';
import { applyThreadDrag, orderGroups, orderThreads } from '../sidebar/ordering';
import { useSidebarPinStore } from '../sidebar/pin-store';
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
  const effortMutation = useMutation(setEffort, { onError });
  // Workflow-mode switches ride the generic input op; the mode reflects via current-mode-update.
  const modeMutation = useMutation(sendInput, { onError });
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
  const pinnedSessionIds = useSidebarPinStore((state) => state.pinnedSessionIds);
  const toggleSessionPinned = useSidebarPinStore((state) => state.togglePinned);
  const groupOrder = useSidebarOrderStore((state) => state.groupOrder);
  const threadOrder = useSidebarOrderStore((state) => state.threadOrder);
  const setGroupOrder = useSidebarOrderStore((state) => state.setGroupOrder);
  const setThreadOrder = useSidebarOrderStore((state) => state.setThreadOrder);
  const [previewExpandedKeys, addPreviewExpanded, removePreviewExpanded] = useSet<string>();
  const [historyOpenKeys, addHistoryOpen, removeHistoryOpen] = useSet<string>();
  const threadGroups = useMemo<ThreadGroupViewModel[]>(() => {
    const groups = groupThreadsByWorkspace(sessions.sessions, workspaces ?? []);
    return orderGroups(groups, groupOrder).map((group) => {
      const collapsed = collapsedKeys.includes(group.collapseKey);
      const previewExpanded = previewExpandedKeys.has(group.key);
      const historyOpen = historyOpenKeys.has(group.key);
      const ordered = orderThreads(
        group.sessions,
        pinnedSessionIds,
        threadOrder[group.collapseKey] ?? [],
      );
      const { sessions: visibleSessions, hasOverflow } = selectVisibleSessions(ordered, {
        collapsed,
        expanded: previewExpanded,
        activeId: sessions.activeId,
      });
      return {
        ...group,
        sessions: ordered,
        visibleSessions,
        hasOverflow,
        collapsed,
        previewExpanded,
        historyOpen,
      };
    });
  }, [
    sessions.sessions,
    sessions.activeId,
    workspaces,
    collapsedKeys,
    pinnedSessionIds,
    groupOrder,
    threadOrder,
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

  function handleModeChange(modeId: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Unlike model/effort, the composer doesn't await this to reflect the pick locally: the active
    // mode only ever comes back via current-mode-update, and failures surface in the error banner.
    return modeMutation
      .trigger({ sessionId: sessions.activeId, input: { type: 'set-mode', modeId } })
      .then(noop);
  }

  function handleModelChange(model: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Let the rejection propagate: the composer awaits it to decide whether to reflect the pick.
    // onError (wired into modelMutation above) still reports the failure via the error banner.
    return modelMutation.trigger({ sessionId: sessions.activeId, model }).then(noop);
  }

  function handleEffortChange(effort: EffortLevel): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Same contract as handleModelChange: the composer awaits the rejection to keep the old pick.
    return effortMutation.trigger({ sessionId: sessions.activeId, effort }).then(noop);
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

  function handleReorderGroups(orderedCollapseKeys: string[]): void {
    setGroupOrder(orderedCollapseKeys);
  }

  function handleReorderThreads(
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ): void {
    const group = threadGroups.find((candidate) => candidate.collapseKey === collapseKey);
    if (!group) return;
    const next = applyThreadDrag({
      orderedIds: group.sessions.map((session) => session.sessionId),
      pinnedIds: pinnedSessionIds,
      activeId,
      overId,
      placement,
    });
    if (next) setThreadOrder(collapseKey, next);
  }

  // The chat workspace is a fixed system entry (the sidebar's "Chats" section, not a Projects
  // group) — excluded from the picker every other workspace-selection flow (New Task, Add
  // workspace, per-group New thread) offers.
  const projectWorkspaces = (workspaces ?? []).filter(
    (workspace) => workspaceKind(workspace) !== 'chat',
  );

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
      workspaces={projectWorkspaces}
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
      pinnedSessionIds={pinnedSessionIds}
      onSelectSession={sessions.select}
      onStopSession={sessions.stop}
      onToggleSessionPinned={toggleSessionPinned}
      onReorderGroups={handleReorderGroups}
      onReorderThreads={handleReorderThreads}
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
      onModeChange={handleModeChange}
      onModelChange={handleModelChange}
      onEffortChange={handleEffortChange}
    />
  );
}

function RuntimeTerminalBlock({ terminalId }: { terminalId: string }): React.ReactNode {
  const output = useTerminalOutput(terminalId);
  return <TerminalBlock terminalId={terminalId} output={output} />;
}
