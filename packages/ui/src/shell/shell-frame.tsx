import type {
  AgentKind,
  EffortLevel,
  QuestionOutcome,
  SessionId,
  SessionInfo,
  WorkspaceRecord,
} from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import type { PermissionDecision } from '../chat/conversation-prompts';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import { ConversationSurface } from './conversation-surface';
import { ErrorBanner } from './error-banner';
import type { NewSessionDraft, NewSessionSubmission } from './new-session-surface';
import { NewSessionSurface } from './new-session-surface';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';
import type { ThreadGroupActions, ThreadGroupState } from './sidebar';
import type { ThreadGroupViewModel } from './threads-view';

/** Session/group action field names this shell exposes under its own naming (`onSelectSession`, etc). */
type RenamedThreadGroupActions = 'onSelect' | 'onClose';

export interface ShellFrameProps
  extends Pick<ThreadGroupActions, Exclude<keyof ThreadGroupActions, RenamedThreadGroupActions>>,
    Pick<ThreadGroupState, 'pinnedSessionIds' | 'collapsedSections'> {
  threadGroups: ThreadGroupViewModel[];
  workspaces: WorkspaceRecord[];
  workspacesLoading?: boolean;
  /** First load of the session list — the sidebar's "Chats" section shows a skeleton, not the empty hint. */
  sessionsLoading?: boolean;
  /** The daemon-owned chat workspace, offered by the new-session page's picker as "Chat". */
  chatWorkspace: WorkspaceRecord | null;
  /** Derived once by the workbench surface; shells consume it instead of re-deriving from the list. */
  activeSession: SessionInfo | null;
  /** Non-null while the new-session page is up — it replaces the conversation column. */
  draft: NewSessionDraft | null;
  /** Agent runtime availability cues: the new-session page's onboarding flow (CODE-112) and the
   * active session's needs-login recovery card (CODE-172). */
  runtimeCues?: AgentRuntimeCues;
  /** Triggers (or retries) the managed download for an agent whose CLI is missing. */
  onDownloadAgent?: (kind: AgentKind) => void;
  /** Accepts an out-of-range detected version for the current pick. */
  onContinueUnverified?: (kind: AgentKind) => void;
  /** Starts (or retries) the interactive login for a signed-out agent. */
  onLoginAgent?: (kind: AgentKind) => void;
  /** Submits the authorization code pasted from the browser during a login. */
  onSubmitLoginCode?: (kind: AgentKind, code: string) => void;
  /** Aborts an in-flight login. */
  onCancelLogin?: (kind: AgentKind) => void;
  conversation: ConversationViewModel;
  permissionDecisions: ReadonlyMap<string, PermissionDecision>;
  respondingPermissions: ReadonlySet<string>;
  answeredQuestionIds: ReadonlySet<string>;
  respondingQuestions: ReadonlySet<string>;
  header?: React.ReactNode;
  errorMessage?: string | null;
  onSelectSession: (id: SessionId) => void;
  /** Stop the session if live and remove it from the sidebar list. */
  onCloseSession: (id: SessionId) => void;
  /** Persists a group drag: the full new project-group order, as `collapseKey`s. */
  onReorderGroups: (orderedCollapseKeys: string[]) => void;
  /** Persists a thread drag within a group: `activeId` landed before/after `overId`. */
  onReorderThreads: (
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ) => void;
  /** Starts the drafted session and sends its first prompt; rejection keeps the page up. */
  onSubmitDraft: (submission: NewSessionSubmission) => Promise<void>;
  /** Registers a directory as a workspace; every shell wires this into the sidebar's Add workspace row. */
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
  /** Hosts inline artifact content on the daemon (sandboxed html previews, CODE-62). */
  onHostArtifact?: (content: string, mimeType: string) => Promise<{ url: string }>;
  /** Opens the command palette — the sidebar Search entry stays disabled without it. */
  onOpenSearch?: () => void;
  /** Platform-formatted hint next to the Search entry, e.g. `⌘K`. */
  searchShortcut?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onDismissError?: () => void;
  onModeChange?: (modeId: string) => Promise<void>;
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
  onInvokeCommand?: (name: string, args?: string) => void;
  onRunShellCommand?: (command: string) => void;
}

export function ShellFrame({
  threadGroups,
  workspaces,
  workspacesLoading,
  sessionsLoading,
  chatWorkspace,
  activeSession,
  draft,
  runtimeCues,
  onDownloadAgent,
  onContinueUnverified,
  onLoginAgent,
  onSubmitLoginCode,
  onCancelLogin,
  conversation,
  permissionDecisions,
  respondingPermissions,
  answeredQuestionIds,
  respondingQuestions,
  header,
  errorMessage,
  pinnedSessionIds,
  collapsedSections,
  onSelectSession,
  onCloseSession,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onStartDraft,
  onSubmitDraft,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onToggleSectionCollapsed,
  onTogglePreviewExpanded,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onRespondQuestion,
  onHostArtifact,
  onOpenSearch,
  searchShortcut,
  TerminalBlockComponent,
  BranchStatusComponent,
  onDismissError,
  onModeChange,
  onApprovalPolicyChange,
  onModelChange,
  onEffortChange,
  onInvokeCommand,
  onRunShellCommand,
}: ShellFrameProps): React.ReactNode {
  const active = activeSession;
  const isRunning = conversation.status === 'running' || conversation.status === 'starting';

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <SessionSidebar
          threadGroups={threadGroups}
          workspacesLoading={workspacesLoading}
          sessionsLoading={sessionsLoading}
          activeId={active?.sessionId ?? null}
          pinnedSessionIds={pinnedSessionIds}
          collapsedSections={collapsedSections}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onClose={onCloseSession}
          onToggleSessionPinned={onToggleSessionPinned}
          onReorderGroups={onReorderGroups}
          onReorderThreads={onReorderThreads}
          onStartDraft={onStartDraft}
          onRegisterWorkspace={onRegisterWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onArchiveWorkspace={onArchiveWorkspace}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onToggleSectionCollapsed={onToggleSectionCollapsed}
          onTogglePreviewExpanded={onTogglePreviewExpanded}
          onOpenSearch={onOpenSearch}
          searchShortcut={searchShortcut}
          BranchStatusComponent={BranchStatusComponent}
        />
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <ErrorBanner errorMessage={errorMessage} onDismissError={onDismissError} />
        {draft ? (
          // Keyed per entry point so opening from another group resets the page's picks.
          <NewSessionSurface
            key={draft.initialWorkspaceId ?? 'default'}
            className="min-h-0 flex-1"
            draft={draft}
            workspaces={workspaces}
            chatWorkspace={chatWorkspace}
            runtimeCues={runtimeCues}
            onContinueUnverified={onContinueUnverified}
            onDownloadAgent={onDownloadAgent}
            onLoginAgent={onLoginAgent}
            onSubmitLoginCode={onSubmitLoginCode}
            onCancelLogin={onCancelLogin}
            onSubmit={onSubmitDraft}
            onRegisterWorkspace={onRegisterWorkspace}
          />
        ) : (
          // Keyed per session: switching resets the composer draft and scroll without touching the shell.
          <ConversationSurface
            key={active?.sessionId ?? 'no-active-session'}
            className="min-h-0 flex-1"
            conversation={conversation}
            agentKind={active?.kind}
            agentLabel={active ? active.kind : undefined}
            disabled={!active || active.status === 'stopped'}
            isRunning={isRunning}
            cwd={active?.cwd}
            runtimeCues={runtimeCues}
            onLoginAgent={onLoginAgent}
            onSubmitLoginCode={onSubmitLoginCode}
            onCancelLogin={onCancelLogin}
            permissionDecisions={permissionDecisions}
            respondingPermissions={respondingPermissions}
            answeredQuestionIds={answeredQuestionIds}
            respondingQuestions={respondingQuestions}
            TerminalBlockComponent={TerminalBlockComponent}
            onSendPrompt={onSendPrompt}
            onStopTurn={onStopTurn}
            onRespondPermission={onRespondPermission}
            onRespondQuestion={onRespondQuestion}
            onHostArtifact={onHostArtifact}
            onModeChange={onModeChange}
            onApprovalPolicyChange={onApprovalPolicyChange}
            onModelChange={onModelChange}
            onEffortChange={onEffortChange}
            onInvokeCommand={onInvokeCommand}
            onRunShellCommand={onRunShellCommand}
          />
        )}
      </main>
    </div>
  );
}
