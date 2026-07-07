import type { Conversation } from '@linkcode/client-core';
import type {
  EffortLevel,
  QuestionOutcome,
  SessionId,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import { workspaceKind } from '@linkcode/schema';
import {
  archiveWorkspace,
  cancelTurn,
  hostArtifact,
  promptText,
  registerWorkspace,
  respondPermission,
  respondQuestion,
  sendInput,
  setEffort,
  setModel,
  updateWorkspace,
} from '@linkcode/sdk';
import type {
  NewSessionDraft,
  NewSessionSubmission,
  PermissionDecision,
  ThreadGroupViewModel,
} from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useAgentRuntimeOnboarding } from '../agent-runtime/onboarding';
import { WorkbenchCommandPalette } from '../palette/command-palette';
import { openCommandPalette } from '../palette/store';
import { useWorkbenchSdkClient } from '../runtime/provider';
import { useMutation } from '../runtime/tayori';
import { RuntimeBranchStatus } from '../sidebar/branch-status';
import { useSidebarGroupCollapseStore } from '../sidebar/collapse-store';
import { groupThreadsByWorkspace } from '../sidebar/group-threads';
import { useSidebarOrderStore } from '../sidebar/order-store';
import { applyThreadDrag, orderGroups, orderThreads } from '../sidebar/ordering';
import { useSidebarPinStore } from '../sidebar/pin-store';
import { selectVisibleSessions } from '../sidebar/visible-sessions';
import { RuntimeWorkspaceHistory } from '../sidebar/workspace-history';
import { RuntimeTerminalBlock } from '../terminal/block';
import { useWorkspaces } from '../workspace/hooks';
import { useNewSessionDefaultsStore } from './new-session-defaults-store';
import type { WorkbenchShellComponent } from './shell';
import { DefaultWorkbenchShell } from './shell';
import { useSeededConversation } from './use-seeded-conversation';
import type { WorkbenchSessions } from './use-workbench-sessions';
import { useWorkbenchSessions } from './use-workbench-sessions';

export interface WorkbenchProps {
  shellComponent?: WorkbenchShellComponent;
  /** Platform-formatted hint for the palette trigger (e.g. `⌘K`); apps own the label. */
  paletteShortcut?: string;
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
  paletteShortcut,
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
  // column (the shells key their ConversationSurface), and the permission state below survives
  // switches safely because adapter requestIds are globally unique.
  return (
    <>
      <WorkbenchSessionSurface
        sessions={sessions}
        conversation={conversation}
        errorMessage={errorMessage}
        ShellComponent={ShellComponent}
        paletteShortcut={paletteShortcut}
        onClearError={() => setErrorMessage(null)}
        onError={handleError}
      />
      <WorkbenchCommandPalette sessions={sessions} />
    </>
  );
}

interface WorkbenchSessionSurfaceProps {
  sessions: WorkbenchSessions;
  conversation: Conversation;
  errorMessage: string | null;
  ShellComponent: WorkbenchShellComponent;
  paletteShortcut?: string;
  onClearError: () => void;
  onError: (err: unknown) => void;
}

function WorkbenchSessionSurface({
  sessions,
  conversation,
  errorMessage,
  ShellComponent,
  paletteShortcut,
  onClearError,
  onError,
}: WorkbenchSessionSurfaceProps): React.ReactNode {
  const tk = useTranslations('workbench.agentKind');
  const promptMutation = useMutation(promptText, { onError });
  const cancelMutation = useMutation(cancelTurn, { onError });
  const permissionMutation = useMutation(respondPermission, { onError });
  const questionMutation = useMutation(respondQuestion, { onError });
  const modelMutation = useMutation(setModel, { onError });
  const effortMutation = useMutation(setEffort, { onError });
  // Workflow-mode and approval-policy switches ride the generic input op; each reflects back via
  // its own session event (current-mode-update / approval-policy-update).
  const inputMutation = useMutation(sendInput, { onError });
  const [permissionDecisions, setPermissionDecisions] = useState(
    () => new Map<string, PermissionDecision>(),
  );
  const [responding, addResponding, removeResponding] = useSet<string>();
  const [answeredQuestions, addAnsweredQuestion] = useSet<string>();
  const [respondingQuestions, addRespondingQuestion, removeRespondingQuestion] = useSet<string>();
  const active = sessions.active;
  const sdkClient = useWorkbenchSdkClient();
  const activeSessionId = sessions.activeId;
  // Announce observation of the focused session so the daemon replays buffered per-session state
  // (the approval-policy advertisement) this client missed — e.g. a reload attaching to an
  // already-live session. Fire-and-forget; live events cover everything after this point.
  useEffect(() => {
    if (activeSessionId) sdkClient.raw.attachSession(activeSessionId);
  }, [sdkClient, activeSessionId]);
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
  const lastProvider = useNewSessionDefaultsStore((state) => state.lastProvider);
  const lastWorkspaceId = useNewSessionDefaultsStore((state) => state.lastWorkspaceId);
  const onboarding = useAgentRuntimeOnboarding();
  const rememberNewSessionDefaults = useNewSessionDefaultsStore((state) => state.remember);
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

  async function handleSubmitDraft(submission: NewSessionSubmission): Promise<void> {
    onClearError();
    // Rejections propagate so the new-session page stays up; the error banner reports them.
    const sessionId = await sessions.create({
      kind: submission.kind,
      cwd: submission.cwd,
      model: submission.model,
      modeId: submission.modeId,
    });
    rememberNewSessionDefaults(submission.kind, submission.workspaceId);
    // The first prompt rides behind the started session, like any conversation send.
    void promptMutation.trigger({ sessionId, text: submission.prompt }).catch(noop);
  }

  async function handleHostArtifact(content: string, mimeType: string): Promise<{ url: string }> {
    const { data } = await hostArtifact({ content, mimeType });
    return { url: data.url };
  }

  function handleModeChange(modeId: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Unlike model/effort, the composer doesn't await this to reflect the pick locally: the active
    // mode only ever comes back via current-mode-update, and failures surface in the error banner.
    return inputMutation
      .trigger({ sessionId: sessions.activeId, input: { type: 'set-mode', modeId } })
      .then(noop);
  }

  function handleApprovalPolicyChange(policyId: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Same contract as handleModeChange: the pick reflects back via approval-policy-update.
    return inputMutation
      .trigger({ sessionId: sessions.activeId, input: { type: 'set-approval-policy', policyId } })
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

  // Every workspace-mutating request revalidates the workspace list the same way afterward.
  function afterWorkspacesChange<T>(pending: Promise<T>): Promise<T> {
    return pending.then((result) => {
      void refreshWorkspaces();
      return result;
    });
  }

  function handleRegisterWorkspace(cwd: string): Promise<WorkspaceRecord> {
    return afterWorkspacesChange(registerWorkspaceMutation.trigger({ cwd }));
  }

  function handleRenameWorkspace(workspaceId: WorkspaceId, name: string): Promise<void> {
    // Let the rejection propagate: the group header awaits it to show an inline error.
    return afterWorkspacesChange(updateWorkspaceMutation.trigger({ workspaceId, name })).then(noop);
  }

  function handleArchiveWorkspace(workspaceId: WorkspaceId): Promise<void> {
    return afterWorkspacesChange(archiveWorkspaceMutation.trigger({ workspaceId })).then(noop);
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
  // group) — split out so the new-session picker offers it as its own "Chat" entry.
  const allWorkspaces = workspaces ?? [];
  const chatWorkspace =
    allWorkspaces.find((workspace) => workspaceKind(workspace) === 'chat') ?? null;
  const projectWorkspaces = allWorkspaces.filter(
    (workspace) => workspaceKind(workspace) !== 'chat',
  );

  // Resolve the draft's initial picks: an explicit preselection (group "+", Chats "+") wins, then
  // the persisted last-used workspace (if it still exists), then chat, then the first project.
  const persistedWorkspaceId =
    lastWorkspaceId != null &&
    allWorkspaces.some((workspace) => workspace.workspaceId === lastWorkspaceId)
      ? lastWorkspaceId
      : null;
  const draft: NewSessionDraft | null = sessions.draft
    ? {
        initialWorkspaceId:
          sessions.draft.workspaceId ??
          persistedWorkspaceId ??
          chatWorkspace?.workspaceId ??
          projectWorkspaces[0]?.workspaceId ??
          null,
        initialProvider: lastProvider ?? 'claude-code',
      }
    : null;

  function handleRespond(requestId: string, decision: PermissionDecision): void {
    if (!sessions.activeId) return;
    onClearError();
    addResponding(requestId);
    void permissionMutation
      .trigger({
        sessionId: sessions.activeId,
        requestId,
        // The UI prompt is generic; the transport still expects the permission schema outcome.
        outcome:
          decision.outcome === 'cancelled'
            ? { outcome: 'cancelled' }
            : { outcome: 'selected', optionId: decision.option.optionId },
      })
      .then(() => {
        setPermissionDecisions((previous) => new Map(previous).set(requestId, decision));
      })
      .catch(noop)
      .finally(() => {
        removeResponding(requestId);
      });
  }

  function handleRespondQuestion(requestId: string, outcome: QuestionOutcome): void {
    if (!sessions.activeId) return;
    onClearError();
    addRespondingQuestion(requestId);
    void questionMutation
      .trigger({ sessionId: sessions.activeId, requestId, outcome })
      .then(() => {
        addAnsweredQuestion(requestId);
      })
      .catch(noop)
      .finally(() => {
        removeRespondingQuestion(requestId);
      });
  }

  return (
    <ShellComponent
      threadGroups={threadGroups}
      workspaces={projectWorkspaces}
      workspacesLoading={workspacesLoading}
      sessionsLoading={sessions.isLoading}
      chatWorkspace={chatWorkspace}
      activeSession={active}
      draft={draft}
      runtimeCues={onboarding.cues}
      onDownloadAgent={onboarding.download}
      onContinueUnverified={onboarding.acknowledgeUnverified}
      conversation={conversation}
      permissionDecisions={permissionDecisions}
      respondingPermissions={responding}
      answeredQuestionIds={answeredQuestions}
      respondingQuestions={respondingQuestions}
      header={{
        title: active ? (active.title ?? tk(active.kind)) : 'Link Code',
        subtitle: active?.cwd,
        usage: conversation.usage,
      }}
      navigation={{
        canGoBack: sessions.canGoBack,
        canGoForward: sessions.canGoForward,
        onBack: sessions.goBack,
        onForward: sessions.goForward,
      }}
      errorMessage={errorMessage}
      pinnedSessionIds={pinnedSessionIds}
      onSelectSession={sessions.select}
      onCloseSession={sessions.close}
      onToggleSessionPinned={toggleSessionPinned}
      onReorderGroups={handleReorderGroups}
      onReorderThreads={handleReorderThreads}
      onStartDraft={sessions.startDraft}
      onSubmitDraft={handleSubmitDraft}
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
      onRespondQuestion={handleRespondQuestion}
      onHostArtifact={handleHostArtifact}
      onOpenSearch={openCommandPalette}
      searchShortcut={paletteShortcut}
      TerminalBlockComponent={RuntimeTerminalBlock}
      BranchStatusComponent={RuntimeBranchStatus}
      HistoryComponent={RuntimeWorkspaceHistory}
      onDismissError={onClearError}
      onModeChange={handleModeChange}
      onApprovalPolicyChange={handleApprovalPolicyChange}
      onModelChange={handleModelChange}
      onEffortChange={handleEffortChange}
    />
  );
}
