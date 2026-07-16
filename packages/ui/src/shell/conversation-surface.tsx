import type { AgentKind, ContentBlock, EffortLevel, QuestionOutcome } from '@linkcode/schema';
import { useRef } from 'react';
import { ArtifactHostActionsProvider } from '../chat/artifacts/context';
import type { PermissionDecision } from '../chat/conversation-prompts';
import { ConversationView } from '../chat/conversation-view';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import { AgentOnboardingCard } from './agent-onboarding-card';
import type { ComposerHandle, MentionItem } from './composer';
import { Composer } from './composer';
import type { ComposerAttachment } from './composer-attachments';
import { ConversationPromptDock } from './conversation-prompt-dock';

export interface ConversationSurfaceProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  agentLabel?: string;
  /** Frontend capability stub used until attachment support is advertised by the session. */
  attachmentsSupported?: boolean;
  cwd?: string;
  /** TODO(backend): thread the session's active model here once the daemon reflects it. */
  modelName?: string;
  respondingRequestIds: ReadonlySet<string>;
  responseErrors?: ReadonlyMap<string, string>;
  /** Runtime availability cues (CODE-172): only a `needs-login` cue for this session's agent
   * surfaces here — the sign-in recovery after an auth-failed turn. Install/version cues never
   * block a session that is already running. */
  runtimeCues?: AgentRuntimeCues;
  /** Starts (or retries) the interactive login for the signed-out agent. */
  onLoginAgent?: (kind: AgentKind) => void;
  /** Submits the authorization code pasted from the browser during a login. */
  onSubmitLoginCode?: (kind: AgentKind, code: string) => void;
  /** Aborts an in-flight login. */
  onCancelLogin?: (kind: AgentKind) => void;
  disabled?: boolean;
  isRunning: boolean;
  topContent?: React.ReactNode;
  className?: string;
  conversationClassName?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  /** Entries for the composer's `@` menu (workspace files, sourced by the app). */
  mentionItems?: MentionItem[];
  /** Reports the live `@` query so the app can fetch `mentionItems` for it. */
  onMentionQueryChange?: (query: string | null) => void;
  onSendPrompt: (content: ContentBlock[]) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
  /** Opens a produced-file artifact in the shell's viewer (desktop right panel). Absent
   * when the shell has no viewer — file cards then render without the open affordance. */
  onOpenFileArtifact?: (path: string) => void;
  /** Opens workspace changes in the shell's review surface. */
  onReviewChanges?: () => void;
  /** Hosts inline content on the daemon's ephemeral origin (sandboxed html previews). */
  onHostArtifact?: (content: string, mimeType: string) => Promise<{ url: string }>;
  /** Promotes a hosted/preview URL to the shell's browser surface; default: new tab. */
  onOpenPreviewUrl?: (url: string) => void;
  /** Opens a native file picker and returns the picked images, ready to stage. Desktop-only
   * (built by combining the system dialog with a daemon file read) — absent on webview, where
   * the composer's "Attach" action falls back to the Coss file input. */
  onPickAttachmentFiles?: () => Promise<ComposerAttachment[]>;
  onModeChange?: (modeId: string) => Promise<void>;
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
  /** Sends a catalog slash-command invocation (see Composer.onInvokeCommand). */
  onInvokeCommand?: (name: string, args?: string) => void;
  /** Sends a `$` shell passthrough (see Composer.onRunShellCommand). */
  onRunShellCommand?: (command: string) => void;
}

export function ConversationSurface({
  conversation,
  agentKind,
  agentLabel,
  attachmentsSupported = false,
  cwd,
  modelName,
  respondingRequestIds,
  responseErrors,
  runtimeCues,
  onLoginAgent,
  onSubmitLoginCode,
  onCancelLogin,
  disabled = false,
  isRunning,
  topContent,
  className,
  conversationClassName,
  TerminalBlockComponent,
  mentionItems,
  onMentionQueryChange,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onRespondQuestion,
  onOpenFileArtifact,
  onReviewChanges,
  onHostArtifact,
  onOpenPreviewUrl,
  onPickAttachmentFiles,
  onModeChange,
  onApprovalPolicyChange,
  onModelChange,
  onEffortChange,
  onInvokeCommand,
  onRunShellCommand,
}: ConversationSurfaceProps): React.ReactNode {
  const composerRef = useRef<ComposerHandle | null>(null);
  // Only the signed-out cue matters mid-session: the next turn would fail on auth anyway, so
  // block it and offer the login flow in place. A missing/unverified CLI stays a new-session
  // concern — this session's process is already running.
  const cue = agentKind === undefined ? undefined : runtimeCues?.[agentKind];
  const loginCue = cue?.state === 'needs-login' ? cue : undefined;
  // Artifact interactions (click-to-reference) land in this surface's own composer;
  // the loop stays inside the presentation layer.
  const artifactActions = {
    referenceToComposer: (text: string) => composerRef.current?.insertText(text),
    openFile: onOpenFileArtifact,
    reviewChanges: onReviewChanges,
    hostArtifact: onHostArtifact,
    openPreviewUrl: onOpenPreviewUrl,
  };

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      {topContent}
      <div className={cn('min-h-0 flex-1', conversationClassName)}>
        <ArtifactHostActionsProvider actions={artifactActions}>
          <ConversationView
            conversation={conversation}
            agentKind={agentKind}
            cwd={cwd}
            modelName={modelName}
            TerminalBlockComponent={TerminalBlockComponent}
            onReviewChanges={onReviewChanges}
          />
        </ArtifactHostActionsProvider>
      </div>
      <ConversationPromptDock
        conversation={conversation}
        respondingRequestIds={respondingRequestIds}
        responseErrors={responseErrors}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />
      {loginCue && agentKind && (
        <div className="px-4 pb-3">
          <div className="mx-auto max-w-3xl">
            <AgentOnboardingCard
              cue={loginCue}
              kind={agentKind}
              onCancelLogin={onCancelLogin}
              onLogin={onLoginAgent}
              onSubmitLoginCode={onSubmitLoginCode}
            />
          </div>
        </div>
      )}
      {/* TODO(backend): pass the agent-advertised mode list (session-modes.ts) once the daemon
          emits it; the composer stubs the workflow-mode list today. */}
      <Composer
        handleRef={composerRef}
        agentLabel={agentLabel}
        agentKind={agentKind}
        attachmentsSupported={attachmentsSupported}
        disabled={disabled}
        isRunning={isRunning}
        mentionItems={mentionItems}
        onMentionQueryChange={onMentionQueryChange}
        sendBlocked={loginCue !== undefined}
        currentModeId={conversation.currentModeId}
        approvalPolicy={conversation.approvalPolicy}
        currentModel={conversation.currentModel}
        currentEffort={conversation.currentEffort}
        agentCommands={conversation.availableCommands}
        agentCapabilities={conversation.capabilities}
        onSend={onSendPrompt}
        onInvokeCommand={onInvokeCommand}
        onRunShellCommand={onRunShellCommand}
        onStop={onStopTurn}
        onPickAttachmentFiles={onPickAttachmentFiles}
        onModeChange={onModeChange}
        onApprovalPolicyChange={onApprovalPolicyChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    </div>
  );
}
