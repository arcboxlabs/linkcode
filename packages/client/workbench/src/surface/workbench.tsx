import type { Conversation } from '@linkcode/client-core';
import type {
  AgentInput,
  ContentBlock,
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
  readWorkspaceFile,
  registerWorkspace,
  respondPermission,
  respondQuestion,
  sendInput,
  setEffort,
  setModel,
  updateWorkspace,
} from '@linkcode/sdk';
import type {
  AttachmentSupportByAgent,
  ComposerAttachment,
  ComposerDirectiveControls,
  ConversationComposerController,
  NewSessionDraft,
  NewSessionSubmission,
  PermissionDecision,
  ThreadGroupViewModel,
} from '@linkcode/ui';
import {
  attachmentFromReadFile,
  extractPinnedGroup,
  failedComposerAttachmentFromPath,
  groupThreadsByWorkspace,
  useKeyboardShortcutLabel,
} from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useAgentRuntimeOnboarding } from '../agent-runtime/onboarding';
import { useFileMentionSource } from '../files/mentions';
import { WorkbenchCommandPalette } from '../palette/command-palette';
import { openCommandPalette } from '../palette/store';
import { useWorkbenchSdkClient } from '../runtime/provider';
import { useMutation } from '../runtime/tayori';
import { useConfiguredDefaultModels } from '../settings/providers/default-models';
import { RuntimeBranchStatus } from '../sidebar/branch-status';
import { useSidebarGroupCollapseStore } from '../sidebar/collapse-store';
import { useSidebarOrderStore } from '../sidebar/order-store';
import { applyThreadDrag, orderGroups, orderThreads } from '../sidebar/ordering';
import { useSidebarPinStore } from '../sidebar/pin-store';
import { selectVisibleSessions } from '../sidebar/visible-sessions';
import { RuntimeTerminalBlock } from '../terminal/block';
import { useWorkspaces } from '../workspace/hooks';
import { submitActiveSessionInput } from './active-session-input';
import { useNewSessionDefaultsStore } from './new-session-defaults-store';
import type { WorkbenchShellComponent } from './shell';
import { DefaultWorkbenchShell } from './shell';
import { newlyConfirmedStartupSelection, reflectedStartupSelection } from './startup-selection';
import { useAgentStartCatalogs } from './use-agent-catalogs';
import { useSeededConversation } from './use-seeded-conversation';
import { useWorkbenchKeyboardShortcuts } from './use-workbench-keyboard-shortcuts';
import type { WorkbenchSessions } from './use-workbench-sessions';
import { useWorkbenchSessions } from './use-workbench-sessions';

// TODO(backend): replace this frontend stub with attachment support advertised by each session.
const ATTACHMENT_SUPPORT: AttachmentSupportByAgent = {
  'claude-code': true,
  codex: true,
  opencode: true,
  pi: true,
  // Headless streaming-json has no image prompt path verified yet.
};

export interface WorkbenchProps {
  shellComponent?: WorkbenchShellComponent;
}

/**
 * The workbench feature surface: session inbox + conversation stream + composer. Assumes the data
 * plane is already mounted above it — wrap in `WorkbenchProviders` and mount as a feature page.
 */
export function Workbench({
  shellComponent: ShellComponent = DefaultWorkbenchShell,
}: WorkbenchProps): React.ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  function handleError(err: unknown): void {
    setErrorMessage(extractErrorMessage(err));
  }

  const rawSessions = useWorkbenchSessions(handleError);
  // Leaving the current surface drops its error state: a stale failure must not follow the user
  // to another thread or the new-thread page (CODE-239). `create` clears at submit time instead.
  const sessions: WorkbenchSessions = {
    ...rawSessions,
    select(id) {
      setErrorMessage(null);
      rawSessions.select(id);
    },
    startDraft(workspaceId) {
      setErrorMessage(null);
      rawSessions.startDraft(workspaceId);
    },
    goBack() {
      setErrorMessage(null);
      rawSessions.goBack();
    },
    goForward() {
      setErrorMessage(null);
      rawSessions.goForward();
    },
    close(id) {
      setErrorMessage(null);
      rawSessions.close(id);
    },
  };
  useWorkbenchKeyboardShortcuts(rootRef, sessions);
  const conversation = useSeededConversation(sessions.active, handleError);

  // Deliberately NOT keyed by the active session: the surface hosts the whole shell (chrome,
  // sidebar, panels, terminals), which must stay permanently mounted across session switches —
  // remounting it flashes the entire window. Per-session UI reset happens at the conversation
  // column (the shells key their ConversationSurface), and in-flight prompt response state below
  // survives switches safely because adapter requestIds are globally unique.
  return (
    <div ref={rootRef} className="h-full min-h-0">
      <WorkbenchSessionSurface
        sessions={sessions}
        conversation={conversation}
        errorMessage={errorMessage}
        ShellComponent={ShellComponent}
        onClearError={() => setErrorMessage(null)}
        onError={handleError}
      />
      <WorkbenchCommandPalette sessions={sessions} />
    </div>
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
  const tComposer = useTranslations('workbench.composer');
  const tPrompt = useTranslations('workbench.prompt');
  const searchShortcut = useKeyboardShortcutLabel('workbench.command-palette');
  const cancelMutation = useMutation(cancelTurn, { onError });
  const permissionMutation = useMutation(respondPermission);
  const questionMutation = useMutation(respondQuestion);
  const modelMutation = useMutation(setModel, { onError });
  const effortMutation = useMutation(setEffort, { onError });
  // Prompts (with attachments) and workflow-mode/approval-policy switches all ride this generic
  // input op; each reflects back via its own session event.
  const inputMutation = useMutation(sendInput, { onError });
  const [respondingRequestIds, addRespondingRequest, removeRespondingRequest] = useSet<string>();
  const [responseErrors, setResponseErrors] = useState(() => new Map<string, string>());
  const visibleResponseErrors = new Map<string, string>();
  for (const requestId of conversation.pendingPermissionIds) {
    const message = responseErrors.get(requestId);
    if (message) visibleResponseErrors.set(requestId, message);
  }
  for (const requestId of conversation.pendingQuestionIds) {
    const message = responseErrors.get(requestId);
    if (message) visibleResponseErrors.set(requestId, message);
  }
  const active = sessions.active;
  const { mentionItems, onMentionQueryChange } = useFileMentionSource();
  const newSessionDefaultModels = useConfiguredDefaultModels();
  const agentCatalogs = useAgentStartCatalogs();
  const sdkClient = useWorkbenchSdkClient();
  const activeSessionId = sessions.activeId;
  // Announce observation of the focused session so the daemon replays buffered per-session state
  // this client missed (e.g. the approval-policy advertisement after a reload). Fire-and-forget.
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
  const collapsedSections = useSidebarGroupCollapseStore((state) => state.collapsedSections);
  const toggleSectionCollapsed = useSidebarGroupCollapseStore(
    (state) => state.toggleSectionCollapsed,
  );
  const pinnedSessionIds = useSidebarPinStore((state) => state.pinnedSessionIds);
  const toggleSessionPinned = useSidebarPinStore((state) => state.togglePinned);
  const groupOrder = useSidebarOrderStore((state) => state.groupOrder);
  const threadOrder = useSidebarOrderStore((state) => state.threadOrder);
  const setGroupOrder = useSidebarOrderStore((state) => state.setGroupOrder);
  const setThreadOrder = useSidebarOrderStore((state) => state.setThreadOrder);
  const lastProvider = useNewSessionDefaultsStore((state) => state.lastProvider);
  const lastWorkspaceId = useNewSessionDefaultsStore((state) => state.lastWorkspaceId);
  const newSessionPreferredModels = useNewSessionDefaultsStore((state) => state.modelsByProvider);
  const newSessionPreferredEfforts = useNewSessionDefaultsStore((state) => state.effortsByProvider);
  const onboarding = useAgentRuntimeOnboarding();
  const rememberNewSessionDefaults = useNewSessionDefaultsStore((state) => state.remember);
  const rememberSelection = useNewSessionDefaultsStore((state) => state.rememberSelection);
  const [previewExpandedKeys, addPreviewExpanded, removePreviewExpanded] = useSet<string>();
  const threadGroups = useMemo<ThreadGroupViewModel[]>(() => {
    const { pinnedGroup, rest } = extractPinnedGroup(sessions.sessions, pinnedSessionIds);
    const groups = orderGroups(groupThreadsByWorkspace(rest, workspaces ?? []), groupOrder);
    return (pinnedGroup ? [pinnedGroup, ...groups] : groups).map((group) => {
      const collapsed = collapsedKeys.includes(group.collapseKey);
      const previewExpanded = previewExpandedKeys.has(group.key);
      const ordered = orderThreads(
        group.sessions,
        pinnedSessionIds,
        threadOrder[group.collapseKey] ?? [],
      );
      const { sessions: visibleSessions, hasOverflow } = selectVisibleSessions(ordered, {
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
  ]);

  function submitActiveInput(input: AgentInput): Promise<void> {
    const sessionId = sessions.activeId;
    if (sessionId) onClearError();
    return submitActiveSessionInput(sessionId, input, inputMutation.trigger);
  }

  function handleSend(content: ContentBlock[]): Promise<void> {
    return submitActiveInput({ type: 'prompt', content });
  }

  function handleStopTurn(): void {
    if (!sessions.activeId) return;
    onClearError();
    void cancelMutation.trigger({ sessionId: sessions.activeId }).catch(noop);
  }

  function handleInvokeCommand(name: string, args?: string): Promise<void> {
    return submitActiveInput({ type: 'command', name, arguments: args });
  }

  function handleRunShellCommand(command: string): Promise<void> {
    return submitActiveInput({ type: 'shell-command', command });
  }

  async function handleSubmitDraft(submission: NewSessionSubmission): Promise<void> {
    onClearError();
    // Rejections propagate so the new-session page stays up; the error banner reports them.
    const sessionId = await sessions.create({
      kind: submission.kind,
      cwd: submission.cwd,
      model: submission.model,
      effort: submission.effort ?? undefined,
      approvalPolicyId: submission.approvalPolicyId,
      modeId: submission.modeId,
    });
    const startupSelection = reflectedStartupSelection(
      submission,
      sdkClient.raw.eventsSnapshot(sessionId),
    );
    rememberNewSessionDefaults(submission.kind, submission.workspaceId, startupSelection);
    // The first input rides behind the started session, like any conversation send.
    void inputMutation
      .trigger({ sessionId, input: submission.input })
      .then(() => {
        // Some process-per-turn adapters can confirm a startup override only after their first
        // successful run. Promote only a positive late match: replaying a mismatch here could erase
        // a newer live selection made while that turn was running.
        const newlyConfirmed = newlyConfirmedStartupSelection(
          submission,
          startupSelection,
          sdkClient.raw.eventsSnapshot(sessionId),
        );
        if (newlyConfirmed.model === undefined && newlyConfirmed.effort === undefined) return;
        rememberSelection(submission.kind, newlyConfirmed);
      })
      .catch(noop);
  }

  async function handleHostArtifact(content: string, mimeType: string): Promise<{ url: string }> {
    const { data } = await hostArtifact({ content, mimeType });
    return { url: data.url };
  }

  /** Reads a natively-picked attachment via the daemon's file-read op (drag-and-drop/paste reads
   * bytes client-side instead). `cwd` only matters for a relative `path`; the picker's is absolute. */
  async function handleReadAttachmentFile(path: string): Promise<ComposerAttachment> {
    try {
      const { data } = await readWorkspaceFile({ cwd: '/', path });
      return attachmentFromReadFile(data, {
        tooLarge: tComposer('attachmentTooLarge'),
        unsupportedType: tComposer('attachmentUnsupportedType'),
      });
    } catch (err) {
      return failedComposerAttachmentFromPath(
        path,
        extractErrorMessage(err) ?? tComposer('attachmentReadFailed'),
      );
    }
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
    const provider = active?.kind;
    return modelMutation.trigger({ sessionId: sessions.activeId, model }).then(() => {
      if (provider) rememberSelection(provider, { model });
    });
  }

  function handleEffortChange(effort: EffortLevel): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Same contract as handleModelChange: the composer awaits the rejection to keep the old pick.
    const provider = active?.kind;
    return effortMutation.trigger({ sessionId: sessions.activeId, effort }).then(() => {
      if (provider) rememberSelection(provider, { effort });
    });
  }

  const directiveControls: ComposerDirectiveControls = {
    slash: conversation.capabilities?.slashCommands
      ? conversation.availableCommands === null
        ? { state: 'loading', onInvokeCommand: handleInvokeCommand }
        : {
            state: 'ready',
            commands: conversation.availableCommands,
            onInvokeCommand: handleInvokeCommand,
          }
      : { state: 'unsupported' },
    shell: conversation.capabilities?.shellCommand
      ? { state: 'ready', onRunShellCommand: handleRunShellCommand }
      : { state: 'unsupported' },
  };
  const conversationComposer: ConversationComposerController = {
    onSend: handleSend,
    onStop: handleStopTurn,
    directiveControls,
    onModeChange: handleModeChange,
    onApprovalPolicyChange: handleApprovalPolicyChange,
    onModelChange: handleModelChange,
    onEffortChange: handleEffortChange,
  };

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
  // Same validation as the persisted default: the store-held draft outlives daemon switches, so
  // its preselection can name a workspace this daemon has never heard of.
  const requestedDraftWorkspaceId = sessions.draft?.workspaceId ?? null;
  const draftWorkspaceId =
    requestedDraftWorkspaceId != null &&
    allWorkspaces.some((workspace) => workspace.workspaceId === requestedDraftWorkspaceId)
      ? requestedDraftWorkspaceId
      : null;
  const draft: NewSessionDraft | null = sessions.draft
    ? {
        initialWorkspaceId:
          draftWorkspaceId ??
          persistedWorkspaceId ??
          chatWorkspace?.workspaceId ??
          projectWorkspaces[0]?.workspaceId ??
          null,
        initialProvider: lastProvider ?? 'claude-code',
      }
    : null;

  function handleRespond(requestId: string, decision: PermissionDecision): void {
    if (!sessions.activeId || respondingRequestIds.has(requestId)) return;
    clearResponseError(requestId);
    addRespondingRequest(requestId);
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
      .catch((error: unknown) => recordResponseError(requestId, error))
      .finally(() => {
        removeRespondingRequest(requestId);
      });
  }

  function handleRespondQuestion(requestId: string, outcome: QuestionOutcome): void {
    if (!sessions.activeId || respondingRequestIds.has(requestId)) return;
    clearResponseError(requestId);
    addRespondingRequest(requestId);
    void questionMutation
      .trigger({ sessionId: sessions.activeId, requestId, outcome })
      .catch((error: unknown) => recordResponseError(requestId, error))
      .finally(() => {
        removeRespondingRequest(requestId);
      });
  }

  function clearResponseError(requestId: string): void {
    setResponseErrors((current) => {
      if (!current.has(requestId)) return current;
      const next = new Map(current);
      next.delete(requestId);
      return next;
    });
  }

  function recordResponseError(requestId: string, error: unknown): void {
    setResponseErrors((current) =>
      new Map(current).set(requestId, extractErrorMessage(error) ?? tPrompt('responseError')),
    );
  }

  return (
    <ShellComponent
      attachmentSupport={ATTACHMENT_SUPPORT}
      threadGroups={threadGroups}
      workspaces={projectWorkspaces}
      workspacesLoading={workspacesLoading}
      sessionsLoading={sessions.isLoading}
      chatWorkspace={chatWorkspace}
      activeSession={active}
      draft={draft}
      newSessionDefaultModels={newSessionDefaultModels}
      agentCatalogs={agentCatalogs}
      newSessionPreferredModels={newSessionPreferredModels}
      newSessionPreferredEfforts={newSessionPreferredEfforts}
      runtimeCues={onboarding.cues}
      onDownloadAgent={onboarding.download}
      onContinueUnverified={onboarding.acknowledgeUnverified}
      onLoginAgent={onboarding.login}
      onSubmitLoginCode={onboarding.submitLoginCode}
      onCancelLogin={onboarding.cancelLogin}
      conversation={conversation}
      respondingRequestIds={respondingRequestIds}
      responseErrors={visibleResponseErrors}
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
      collapsedSections={collapsedSections}
      onSelectSession={sessions.select}
      onCloseSession={sessions.close}
      onToggleSessionPinned={toggleSessionPinned}
      onReorderGroups={handleReorderGroups}
      onReorderThreads={handleReorderThreads}
      onStartDraft={sessions.startDraft}
      onSubmitDraft={handleSubmitDraft}
      onRegisterWorkspace={handleRegisterWorkspace}
      onRenameWorkspace={handleRenameWorkspace}
      onArchiveWorkspace={handleArchiveWorkspace}
      onToggleGroupCollapsed={toggleGroupCollapsed}
      onToggleSectionCollapsed={toggleSectionCollapsed}
      onTogglePreviewExpanded={handleTogglePreviewExpanded}
      mentionItems={mentionItems}
      onMentionQueryChange={onMentionQueryChange}
      conversationComposer={conversationComposer}
      onRespondPermission={handleRespond}
      onRespondQuestion={handleRespondQuestion}
      onHostArtifact={handleHostArtifact}
      onReadAttachmentFile={handleReadAttachmentFile}
      onOpenSearch={openCommandPalette}
      searchShortcut={searchShortcut}
      TerminalBlockComponent={RuntimeTerminalBlock}
      BranchStatusComponent={RuntimeBranchStatus}
      onDismissError={onClearError}
    />
  );
}
