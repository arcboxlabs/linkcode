import type { Conversation, ConversationGraphSnapshot } from '@linkcode/client-core';
import { isRequestFailureReportedInConversation } from '@linkcode/client-core';
import type {
  AgentInput,
  ContentBlock,
  EffortLevel,
  QuestionOutcome,
  SessionId,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import { MessageIdSchema, userRowMessageId, workspaceKind } from '@linkcode/schema';
import {
  archiveWorkspace,
  cancelTurn,
  getProviderConfig,
  hostArtifact,
  hostWorkspaceFile,
  readWorkspaceFile,
  registerWorkspace,
  respondPermission,
  respondQuestion,
  rewritePrompt,
  sendInput,
  setEffort,
  setModel,
  updateWorkspace,
} from '@linkcode/sdk';
import type {
  AttachmentPreview,
  ComposerAttachment,
  ComposerDirectiveControls,
  ConversationComposerController,
  ConversationLineage,
  CurrentPlan,
  ModelOption,
  NewSessionDraft,
  NewSessionSubmission,
  PermissionDecision,
  ThreadGroupViewModel,
} from '@linkcode/ui';
import {
  AttachmentPreviewProvider,
  attachmentFromReadFile,
  extractPinnedGroup,
  failedComposerAttachmentFromPath,
  groupThreadsByWorkspace,
  resetAttachmentPreviews,
  selectCurrentPlan,
  useKeyboardShortcutLabel,
} from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useAgentRuntimeOnboarding } from '../agent-runtime/onboarding';
import { captureProductEvent } from '../analytics/product-analytics';
import { useFileMentionSource } from '../files/mentions';
import { RuntimeNewSessionBranchPicker } from '../git/new-session-branch-picker';
import { WorkbenchCommandPalette } from '../palette/command-palette';
import { openCommandPalette } from '../palette/store';
import { useWorkbenchSdkClient } from '../runtime/provider';
import { useData, useMutation } from '../runtime/tayori';
import {
  selectableHarnessKinds,
  useAccountModelOptions,
} from '../settings/providers/model-options';
import { RuntimeBranchStatus } from '../sidebar/branch-status';
import { useSidebarGroupCollapseStore } from '../sidebar/collapse-store';
import { useSidebarOrderStore } from '../sidebar/order-store';
import { applyThreadDrag, orderGroups, orderThreads } from '../sidebar/ordering';
import { useSidebarPinStore } from '../sidebar/pin-store';
import { selectVisibleSessions } from '../sidebar/visible-sessions';
import { RuntimeTerminalBlock } from '../terminal/block';
import { useWorkspaces } from '../workspace/hooks';
import { submitActiveSessionInput } from './active-session-input';
import {
  continuationParent,
  descendToLeaf,
  lineageParentKey,
  lineagePath,
  lineageVersions,
  siblingsOf,
  turnsById,
} from './lineage';
import type { ParkedLineage } from './lineage-store';
import { useLineageStore } from './lineage-store';
import { useNewSessionDefaultsStore } from './new-session-defaults-store';
import {
  clearInflightUserAttachments,
  isStoredAttachmentBlock,
  noteInflightUserAttachments,
  notePendingUserAttachments,
  overlayPendingUserAttachments,
  pendingUserAttachmentsSnapshot,
  promptBlocksFromComposer,
  resolveStoredAttachmentPreview,
  revokeAttachmentObjectUrls,
  stageStoreAttachment,
  stageStoreAttachmentFromBase64,
  subscribePendingUserAttachments,
} from './prompt-attachments';
import { useSessionSelectionStore } from './selection-store';
import type { WorkbenchShellComponent } from './shell';
import { DefaultWorkbenchShell } from './shell';
import { newlyConfirmedStartupSelection, reflectedStartupSelection } from './startup-selection';
import { RuntimeTaskResourcesPanel } from './task-resources-panel';
import { useAgentStartCatalogs } from './use-agent-catalogs';
import { useSeededConversation } from './use-seeded-conversation';
import { useWorkbenchKeyboardShortcuts } from './use-workbench-keyboard-shortcuts';
import type { WorkbenchSessions } from './use-workbench-sessions';
import { useWorkbenchSessions } from './use-workbench-sessions';

async function handleHostArtifact(content: string, mimeType: string): Promise<{ url: string }> {
  const { data } = await hostArtifact({ content, mimeType });
  return { url: data.url };
}

async function handleHostVideoFile(cwd: string, path: string): Promise<{ url: string }> {
  const { data } = await hostWorkspaceFile({ cwd, path });
  return { url: data.url };
}

function availableWorkspaceId(
  workspaceId: WorkspaceId | null | undefined,
  workspaceIds: ReadonlySet<WorkspaceId>,
): WorkspaceId | null {
  return workspaceId !== null && workspaceId !== undefined && workspaceIds.has(workspaceId)
    ? workspaceId
    : null;
}

export interface WorkbenchProps {
  shellComponent?: WorkbenchShellComponent;
}

/** A new-session workspace choice, tagged with the resolved workspace it was made against so a
 * draft opened from another entry point cannot inherit it. */
interface NewSessionWorkspacePick {
  forInitial: WorkspaceId | null;
  picked: WorkspaceId;
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
  const [workspacePick, setWorkspacePick] = useState<NewSessionWorkspacePick | null>(null);
  function handleError(err: unknown): void {
    setErrorMessage(extractErrorMessage(err));
  }

  function leaveSurface(): void {
    setErrorMessage(null);
    setWorkspacePick(null);
  }

  const rawSessions = useWorkbenchSessions(handleError);
  const sessions: WorkbenchSessions = {
    ...rawSessions,
    select(id) {
      leaveSurface();
      rawSessions.select(id);
    },
    startDraft(workspaceId) {
      leaveSurface();
      rawSessions.startDraft(workspaceId);
    },
    goBack() {
      leaveSurface();
      rawSessions.goBack();
    },
    goForward() {
      leaveSurface();
      rawSessions.goForward();
    },
    close(id) {
      leaveSurface();
      rawSessions.close(id);
    },
  };
  useWorkbenchKeyboardShortcuts(rootRef, sessions);
  const activeSessionId = sessions.active?.sessionId ?? null;
  const { conversation, graph } = useSeededConversation(sessions.active, handleError);
  const parked = useLineageStore((state) =>
    activeSessionId === null ? undefined : state.parkedBySession[activeSessionId],
  );

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
        graph={graph}
        parked={parked}
        errorMessage={errorMessage}
        ShellComponent={ShellComponent}
        workspacePick={workspacePick}
        onWorkspacePick={setWorkspacePick}
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
  /** The active session's turn tree; absent on hosts without a graph or before the first read. */
  graph: ConversationGraphSnapshot | undefined;
  /** The version this client is browsing when it is not the host default. */
  parked: ParkedLineage | undefined;
  errorMessage: string | null;
  ShellComponent: WorkbenchShellComponent;
  workspacePick: NewSessionWorkspacePick | null;
  onWorkspacePick: (pick: NewSessionWorkspacePick) => void;
  onClearError: () => void;
  onError: (err: unknown) => void;
}

function WorkbenchSessionSurface({
  sessions,
  conversation,
  graph,
  parked,
  errorMessage,
  ShellComponent,
  workspacePick,
  onWorkspacePick,
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
  const rewriteMutation = useMutation(rewritePrompt);
  // The host mirrors recoverable turn-input failures into the conversation as `input_rejected`.
  // Keep transport/validation failures global because they do not have a corresponding event.
  const turnInputMutation = useMutation(sendInput, {
    onError(err) {
      if (!isRequestFailureReportedInConversation(err)) onError(err);
    },
  });
  // Workflow-mode and approval-policy switches do not start a turn, so their failures are not
  // mirrored into conversation history and still belong in the global error surface.
  const controlInputMutation = useMutation(sendInput, { onError });
  const [respondingRequestIds, addRespondingRequest, removeRespondingRequest] = useSet<string>();
  const [responseErrors, setResponseErrors] = useState(() => new Map<string, string>());
  const visibleResponseErrors = new Map<string, string>();
  for (let i = 0, len = conversation.pendingPermissionIds.length; i < len; i++) {
    const requestId = conversation.pendingPermissionIds[i];
    const message = responseErrors.get(requestId);
    if (message) visibleResponseErrors.set(requestId, message);
  }
  for (let i = 0, len = conversation.pendingQuestionIds.length; i < len; i++) {
    const requestId = conversation.pendingQuestionIds[i];
    const message = responseErrors.get(requestId);
    if (message) visibleResponseErrors.set(requestId, message);
  }
  const active = sessions.active;
  /** Edits go through the turn graph when the harness can fork after a turn; otherwise the legacy
   * `history.branch` path stays (opencode until its turn-level cut is verified). */
  const graphEditable = active?.historyCapabilities?.forkAfterTurn === true;
  const currentPlan: CurrentPlan | null = selectCurrentPlan(conversation);
  const { mentionItems, onMentionQueryChange } = useFileMentionSource();
  const accountModels = useAccountModelOptions();
  const { data: providers } = useData(getProviderConfig, {});
  const selectableHarnesses = providers === undefined ? null : selectableHarnessKinds(providers);
  const sdkClient = useWorkbenchSdkClient();
  const client = sdkClient.raw;
  const activeSessionId = sessions.activeId;
  const pendingAttachments = useSyncExternalStore(
    subscribePendingUserAttachments,
    pendingUserAttachmentsSnapshot,
  );
  const displayedConversation = overlayPendingUserAttachments(
    conversation,
    activeSessionId,
    pendingAttachments,
  );
  // Announce observation of the focused session so the daemon replays buffered per-session state
  // this client missed (e.g. the approval-policy advertisement after a reload). Fire-and-forget.
  useEffect(() => {
    if (activeSessionId) sdkClient.raw.attachSession(activeSessionId);
  }, [sdkClient, activeSessionId]);
  useEffect(
    () => () => {
      revokeAttachmentObjectUrls();
      resetAttachmentPreviews();
    },
    [activeSessionId],
  );
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
  const lastHarness = useNewSessionDefaultsStore((state) => state.lastHarness);
  const lastWorkspaceId = useNewSessionDefaultsStore((state) => state.lastWorkspaceId);
  const newSessionPreferredEfforts = useNewSessionDefaultsStore((state) => state.effortsByProvider);
  const newSessionPreferredBranches = useNewSessionDefaultsStore(
    (state) => state.branchesByWorkspace,
  );
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
  const threadGroupsByCollapseKey = useMemo(
    () => new Map(threadGroups.map((group) => [group.collapseKey, group] as const)),
    [threadGroups],
  );

  const graphById = graph === undefined ? undefined : turnsById(graph.turns);
  /** Where a turn-starting input lands while this client browses an earlier version: that
   * version's last completed turn — "continue from here" — never onto the host default behind
   * the viewer's back. */
  const parkedTarget =
    parked !== undefined && graph !== undefined && graphById !== undefined
      ? {
          parentTurnId: continuationParent(graphById, parked.leafTurnId),
          expectedGraphRevision: graph.graphRevision,
        }
      : undefined;

  /** The daemon moves its default onto a submitted turn before it replies, so this device follows
   * the lineage it just created by following the default again. */
  function followSubmitted(sessionId: SessionId): void {
    useLineageStore.getState().follow(sessionId);
  }

  function submitActiveInput(input: AgentInput): Promise<void> {
    onClearError();
    if (
      parkedTarget !== undefined &&
      sessions.activeId !== null &&
      (input.type === 'command' || input.type === 'shell-command')
    ) {
      const sessionId = sessions.activeId;
      return client.submitTurn(sessionId, input, parkedTarget).then(() => {
        followSubmitted(sessionId);
      });
    }
    return submitActiveSessionInput(input, turnInputMutation.trigger);
  }

  async function submitPrompt(sessionId: SessionId, content: ContentBlock[]): Promise<void> {
    if (!client.supportsConversationGraph) {
      await submitActiveSessionInput({ type: 'prompt', content }, turnInputMutation.trigger);
      return;
    }
    const blocks = promptBlocksFromComposer(content);
    if (blocks === undefined || blocks.length === 0) {
      if (parkedTarget !== undefined) {
        throw new Error('This content cannot continue an earlier version');
      }
      await submitActiveSessionInput({ type: 'prompt', content }, turnInputMutation.trigger);
      return;
    }
    noteInflightUserAttachments(sessionId, content);
    try {
      const { turnId } = await client.submitTurn(
        sessionId,
        { type: 'prompt', blocks },
        parkedTarget,
      );
      notePendingUserAttachments(sessionId, userRowMessageId(turnId), content);
      clearInflightUserAttachments(sessionId);
      followSubmitted(sessionId);
    } catch (error) {
      clearInflightUserAttachments(sessionId);
      if (!isRequestFailureReportedInConversation(error)) onError(error);
      throw error;
    }
  }

  function handleSend(content: ContentBlock[]): Promise<void> {
    onClearError();
    const { selectedId: sessionId, draft } = useSessionSelectionStore.getState();
    if (draft || !sessionId) return Promise.reject(new Error('No active session'));
    return submitPrompt(sessionId, content).then(() => {
      captureProductEvent('turn submitted', { input_kind: 'prompt' });
    });
  }

  async function handleEditPrompt(
    messageId: string,
    branchCursor: string | undefined,
    content: ContentBlock[],
  ): Promise<void> {
    // Non-destructive rewrite: a sibling under the edited turn's parent (a new root lineage for
    // the first prompt). The old version stays switchable; the host rejects a stale revision. A
    // row the graph does not know (a transcript-seeded session) takes the legacy branch below.
    const turn =
      graph !== undefined && graphEditable
        ? graph.turns.find((candidate) => userRowMessageId(candidate.turnId) === messageId)
        : undefined;
    // Content the graph cannot carry (legacy inline images) branches the old way where it can.
    const blocks = turn === undefined ? undefined : promptBlocksFromComposer(content);
    if (graph !== undefined && active !== null && turn !== undefined && blocks?.length) {
      const { turnId } = await client.submitTurn(
        active.sessionId,
        { type: 'prompt', blocks },
        { parentTurnId: turn.parentTurnId, expectedGraphRevision: graph.graphRevision },
      );
      notePendingUserAttachments(active.sessionId, userRowMessageId(turnId), content);
      followSubmitted(active.sessionId);
      return;
    }
    if (branchCursor === undefined || active?.historyCapabilities?.branch !== true) {
      throw new Error(
        turn === undefined
          ? 'Prompt editing is unavailable for this session'
          : 'Prompt editing is unavailable for this message',
      );
    }
    const stripped = content.filter((block) => !isStoredAttachmentBlock(block));
    await rewriteMutation.trigger({
      sourceSessionId: active.sessionId,
      sourceMessageId: MessageIdSchema.parse(messageId),
      branchCursor,
      content: stripped,
    });
    sessions.refresh();
  }

  function handleStopTurn(): void {
    if (!sessions.activeId) return;
    onClearError();
    void cancelMutation
      .trigger({ sessionId: sessions.activeId })
      .then(() => captureProductEvent('turn cancelled', {}))
      .catch(noop);
  }

  function handleInvokeCommand(name: string, args?: string): Promise<void> {
    return submitActiveInput({ type: 'command', name, arguments: args }).then(() => {
      captureProductEvent('turn submitted', { input_kind: 'command' });
    });
  }

  function handleRunShellCommand(command: string): Promise<void> {
    return submitActiveInput({ type: 'shell-command', command }).then(() => {
      captureProductEvent('turn submitted', { input_kind: 'shell-command' });
    });
  }

  async function handleSubmitDraft(submission: NewSessionSubmission): Promise<void> {
    onClearError();
    // Rejections propagate so the new-session page stays up; the error banner reports them.
    const sessionId = await sessions.create({
      kind: submission.kind,
      cwd: submission.cwd,
      model: submission.model,
      accountId: submission.accountId,
      effort: submission.effort ?? undefined,
      approvalPolicyId: submission.approvalPolicyId,
      modeId: submission.modeId,
      branch: submission.branch,
    });
    const startupSelection = reflectedStartupSelection(
      submission,
      sdkClient.raw.eventsSnapshot(sessionId),
    );
    rememberNewSessionDefaults(
      submission.kind,
      submission.workspaceId,
      startupSelection,
      submission.branch,
    );
    // The first input rides behind the started session, like any conversation send.
    const firstTurn =
      submission.input.type === 'prompt'
        ? submitPrompt(sessionId, submission.input.content)
        : turnInputMutation.trigger({ sessionId, input: submission.input }).then(noop);
    void firstTurn
      .then(() => {
        captureProductEvent('turn submitted', { input_kind: submission.input.type });
        // Some process-per-turn adapters can confirm a startup override only after their first
        // successful run. Promote only a positive late match: replaying a mismatch here could erase
        // a newer live selection made while that turn was running.
        const newlyConfirmed = newlyConfirmedStartupSelection(
          submission,
          startupSelection,
          sdkClient.raw.eventsSnapshot(sessionId),
        );
        // The model is not remembered here: the session carries its own pick, and the agent's
        // default is a deliberate Settings choice that starting one thread must not overwrite.
        if (newlyConfirmed.effort !== undefined) {
          rememberSelection(submission.kind, { effort: newlyConfirmed.effort });
        }
      })
      .catch(noop);
  }

  /** Reads a natively-picked attachment via the daemon's file-read op (drag-and-drop/paste reads
   * bytes client-side instead). `cwd` only matters for a relative `path`; the picker's is absolute. */
  async function handleReadAttachmentFile(path: string): Promise<ComposerAttachment> {
    try {
      const { data } = await readWorkspaceFile({ cwd: '/', path });
      const inline = attachmentFromReadFile(data, {
        tooLarge: tComposer('attachmentTooLarge'),
        unsupportedType: tComposer('attachmentUnsupportedType'),
      });
      if (
        !client.supportsAttachmentStore ||
        inline.status !== 'ready' ||
        data.encoding !== 'base64'
      ) {
        return inline;
      }
      return await stageStoreAttachmentFromBase64(
        client,
        inline,
        data.content,
        data.mimeType,
        data.size,
      );
    } catch (err) {
      return failedComposerAttachmentFromPath(
        path,
        extractErrorMessage(err) ?? tComposer('attachmentReadFailed'),
      );
    }
  }

  function handlePrepareAttachment(
    file: File,
    pending: ComposerAttachment,
  ): Promise<ComposerAttachment> {
    return stageStoreAttachment(client, file, pending, {
      contentMismatch: tComposer('attachmentContentMismatch', { type: file.type }),
    });
  }

  function resolveAttachmentPreview(attachmentId: string): Promise<AttachmentPreview | null> {
    if (!activeSessionId) return Promise.resolve(null);
    return resolveStoredAttachmentPreview(client, activeSessionId, attachmentId);
  }

  function handleModeChange(modeId: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Unlike model/effort, the composer doesn't await this to reflect the pick locally: the active
    // mode only ever comes back via current-mode-update, and failures surface in the error banner.
    return controlInputMutation
      .trigger({ sessionId: sessions.activeId, input: { type: 'set-mode', modeId } })
      .then(noop);
  }

  function handleApprovalPolicyChange(policyId: string): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Same contract as handleModeChange: the pick reflects back via approval-policy-update.
    return controlInputMutation
      .trigger({ sessionId: sessions.activeId, input: { type: 'set-approval-policy', policyId } })
      .then(noop);
  }

  function handleModelChange(model: ModelOption): Promise<void> {
    if (!sessions.activeId) return Promise.reject(new Error('No active session'));
    onClearError();
    // Let the rejection propagate: the composer awaits it to decide whether to reflect the pick.
    // onError (wired into modelMutation above) still reports the failure via the error banner.
    // The engine records the accepted pick on the session's own run, so it survives a relaunch
    // without touching the agent's configured default.
    return modelMutation
      .trigger({
        sessionId: sessions.activeId,
        model: model.id,
        ...(model.accountId !== undefined && { accountId: model.accountId }),
      })
      .then(noop);
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
  function handleSelectVersion(messageId: string, direction: -1 | 1): void {
    if (graph === undefined || active === null) return;
    const turn = graph.turns.find((candidate) => userRowMessageId(candidate.turnId) === messageId);
    if (turn === undefined) return;
    const siblings = siblingsOf(graph.turns, turn);
    const target =
      siblings[siblings.findIndex((sibling) => sibling.turnId === turn.turnId) + direction];
    if (target === undefined) return;
    const store = useLineageStore.getState();
    store.rememberChild(active.sessionId, lineageParentKey(target.parentTurnId), target.turnId);
    const leaf = descendToLeaf(
      graph.turns,
      target.turnId,
      useLineageStore.getState().preferredChildBySession[active.sessionId] ?? {},
    );
    // Switching is a pure read: the host default never moves until something is submitted.
    if (leaf === graph.activeLeafTurnId) store.follow(active.sessionId);
    else store.park(active.sessionId, leaf, graph.activeLeafTurnId);
  }

  function handleJumpToLatest(): void {
    if (active !== null) useLineageStore.getState().follow(active.sessionId);
  }

  /** Fork a new thread through the turn behind a user row: the daemon copies the lineage onto a
   * provider-native fork and this device selects the child; the source is left as it was. */
  function handleForkTurn(messageId: string): void {
    if (graph === undefined || active === null) return;
    const turn = graph.turns.find((candidate) => userRowMessageId(candidate.turnId) === messageId);
    if (turn === undefined) return;
    onClearError();
    void sessions.fork(active.sessionId, turn.turnId, graph.graphRevision).catch(noop);
  }
  const canForkSessions =
    client.supportsSessionFork && active?.historyCapabilities?.forkAfterTurn === true;

  function handleDismissElsewhere(): void {
    if (active !== null && graph !== undefined) {
      useLineageStore.getState().dismissElsewhere(active.sessionId, graph.activeLeafTurnId);
    }
  }

  const isRunning = conversation.status === 'running' || conversation.status === 'starting';
  const lineage: ConversationLineage | undefined =
    graph === undefined || graphById === undefined || active === null
      ? undefined
      : {
          versions: lineageVersions(
            graph.turns,
            lineagePath(graphById, parked?.leafTurnId ?? graph.activeLeafTurnId),
          ),
          onSelectVersion: handleSelectVersion,
          notice:
            parked === undefined
              ? null
              : graph.activeLeafTurnId !== parked.sinceLeafTurnId &&
                  graph.activeLeafTurnId !== parked.dismissedLeafTurnId
                ? {
                    kind: 'elsewhere',
                    onJump: handleJumpToLatest,
                    onDismiss: handleDismissElsewhere,
                  }
                : { kind: 'parked', onJump: handleJumpToLatest },
          rewritesViaGraph: graphEditable,
          promptEditState:
            graphEditable || active.historyCapabilities?.branch === true
              ? isRunning
                ? 'busy'
                : 'enabled'
              : 'unsupported',
          ...(canForkSessions && { onForkTurn: handleForkTurn }),
        };

  const conversationComposer: ConversationComposerController = {
    onSend: handleSend,
    onStop: handleStopTurn,
    onPrepareAttachment: client.supportsAttachmentStore ? handlePrepareAttachment : undefined,
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
    const group = threadGroupsByCollapseKey.get(collapseKey);
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
  const workspacesById = new Map<WorkspaceId, WorkspaceRecord>();
  let chatWorkspace: WorkspaceRecord | null = null;
  const projectWorkspaces: WorkspaceRecord[] = [];
  for (let i = 0, len = allWorkspaces.length; i < len; i++) {
    const workspace = allWorkspaces[i];
    const kind = workspaceKind(workspace);
    if (kind === 'worktree') continue;
    workspacesById.set(workspace.workspaceId, workspace);
    if (kind === 'chat') chatWorkspace ??= workspace;
    else projectWorkspaces.push(workspace);
  }
  const workspaceIds = new Set(workspacesById.keys());

  // Resolve the draft's initial picks: an explicit preselection (group "+", Chats "+") wins, then
  // the persisted last-used workspace (if it still exists), then chat, then the first project.
  const persistedWorkspaceId = availableWorkspaceId(lastWorkspaceId, workspaceIds);
  // Same validation as the persisted default: the store-held draft outlives daemon switches, so
  // its preselection can name a workspace this daemon has never heard of.
  const draftWorkspaceId = availableWorkspaceId(sessions.draft?.workspaceId, workspaceIds);
  const initialWorkspaceId =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the helper explicitly returns null when the requested workspace is unavailable.
    draftWorkspaceId ??
    persistedWorkspaceId ??
    chatWorkspace?.workspaceId ??
    projectWorkspaces[0]?.workspaceId ??
    null;
  const draft: NewSessionDraft | null = sessions.draft
    ? {
        initialWorkspaceId,
        initialHarness: lastHarness ?? 'claude-code',
      }
    : null;

  // The new-session page's workspace is owned above rather than by the surface because the
  // catalogs below are scoped by its cwd — two copies would let them drift and advertise a default
  // the session would not start in. The pick is tagged with the workspace it was resolved against,
  // and leaving the surface clears it (see `leaveSurface`), so a later draft never inherits it.
  const newSessionWorkspaceId =
    workspacePick?.forInitial === initialWorkspaceId ? workspacePick.picked : initialWorkspaceId;
  const agentCatalogs = useAgentStartCatalogs(
    newSessionWorkspaceId === null ? undefined : workspacesById.get(newSessionWorkspaceId)?.cwd,
  );

  function handleNewSessionWorkspaceChange(workspaceId: WorkspaceId): void {
    onWorkspacePick({ forInitial: initialWorkspaceId, picked: workspaceId });
  }

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
    <AttachmentPreviewProvider resolve={resolveAttachmentPreview}>
      <ShellComponent
        resourcesPanel={
          activeSessionId ? (
            <RuntimeTaskResourcesPanel sessionId={activeSessionId} plan={currentPlan} />
          ) : undefined
        }
        threadGroups={threadGroups}
        workspaces={projectWorkspaces}
        workspacesLoading={workspacesLoading}
        sessionsLoading={sessions.isLoading}
        chatWorkspace={chatWorkspace}
        activeSession={active}
        draft={draft}
        newSessionWorkspaceId={newSessionWorkspaceId}
        onNewSessionWorkspaceChange={handleNewSessionWorkspaceChange}
        accountModels={accountModels}
        selectableHarnesses={selectableHarnesses}
        agentCatalogs={agentCatalogs}
        newSessionPreferredEfforts={newSessionPreferredEfforts}
        newSessionPreferredBranches={newSessionPreferredBranches}
        NewSessionBranchPickerComponent={RuntimeNewSessionBranchPicker}
        runtimeCues={onboarding.cues}
        onDownloadAgent={onboarding.download}
        onContinueUnverified={onboarding.acknowledgeUnverified}
        conversation={displayedConversation}
        onEditPrompt={handleEditPrompt}
        lineage={lineage}
        onPrepareAttachment={client.supportsAttachmentStore ? handlePrepareAttachment : undefined}
        respondingRequestIds={respondingRequestIds}
        responseErrors={visibleResponseErrors}
        header={{
          title: active ? (active.title ?? tk(active.kind)) : 'Link Code',
          subtitle: active?.cwd,
          sessionId: active?.sessionId ?? null,
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
        onHostVideoFile={handleHostVideoFile}
        onReadAttachmentFile={handleReadAttachmentFile}
        onOpenSearch={openCommandPalette}
        searchShortcut={searchShortcut}
        TerminalBlockComponent={RuntimeTerminalBlock}
        BranchStatusComponent={RuntimeBranchStatus}
        onDismissError={onClearError}
      />
    </AttachmentPreviewProvider>
  );
}
