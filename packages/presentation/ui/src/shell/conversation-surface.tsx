import type { AgentKind, ContentBlock, EffortLevel, QuestionOutcome } from '@linkcode/schema';
import { useRef } from 'react';
import { ArtifactHostActionsProvider } from '../chat/artifacts/context';
import type { PermissionDecision } from '../chat/conversation-prompts';
import { selectPendingPromptItems } from '../chat/conversation-prompts';
import { ConversationView } from '../chat/conversation-view';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import { AgentOnboardingCard } from './agent-onboarding-card';
import type { ComposerDirectiveControls, ComposerHandle, MentionItem } from './composer';
import { Composer } from './composer';
import type { ComposerAttachment } from './composer-attachments';
import { ConversationPromptDock } from './conversation-prompt-dock';

/** Composer behavior that every app shell must carry as one unit. Keeping the complete controller
 * required prevents a custom shell from silently dropping only mode, slash, or shell actions. */
export interface ConversationComposerController {
  /** Resolves only after the active session accepts the correlated input request. */
  onSend: (content: ContentBlock[]) => Promise<void>;
  onStop: () => void;
  directiveControls: ComposerDirectiveControls;
  onModeChange?: (modeId: string) => Promise<void>;
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
}

export interface ConversationSurfaceProps {
  conversation: ConversationViewModel;
  composer: ConversationComposerController;
  agentKind?: AgentKind;
  agentLabel?: string;
  /** Frontend capability stub used until attachment support is advertised by the session. */
  attachmentsSupported?: boolean;
  cwd?: string;
  /** Overrides the session's reported model (`conversation.currentModel`) in the per-turn meta. */
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
  className?: string;
  conversationClassName?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  /** Entries for the composer's `@` menu (workspace files, sourced by the app). */
  mentionItems?: MentionItem[];
  /** Reports the live `@` query so the app can fetch `mentionItems` for it. */
  onMentionQueryChange?: (query: string | null) => void;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
  /** Opens a produced-file artifact in the shell's viewer (desktop right panel). Absent
   * when the shell has no viewer — file cards then render without the open affordance. */
  onOpenFileArtifact?: (path: string) => void;
  /** Plays a workspace video in the shell's browser surface (desktop Browser pane). Absent
   * when the shell has no browser — video paths then fall back to `onOpenFileArtifact`. */
  onOpenVideoPreview?: (path: string) => void;
  /** Opens workspace changes in the shell's review surface. */
  onReviewChanges?: () => void;
  /** Hosts inline content on the daemon's ephemeral origin (sandboxed html previews). */
  onHostArtifact?: (content: string, mimeType: string) => Promise<{ url: string }>;
  /** Promotes a hosted/preview URL to the shell's browser surface; default: new tab. */
  onOpenPreviewUrl?: (url: string) => void;
  /** Native file picker returning picked images ready to stage. Desktop-only — absent on
   * webview, where the composer's "Attach" action falls back to the Coss file input. */
  onPickAttachmentFiles?: () => Promise<ComposerAttachment[]>;
}

export function ConversationSurface({
  conversation,
  composer,
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
  className,
  conversationClassName,
  TerminalBlockComponent,
  mentionItems,
  onMentionQueryChange,
  onRespondPermission,
  onRespondQuestion,
  onOpenFileArtifact,
  onOpenVideoPreview,
  onReviewChanges,
  onHostArtifact,
  onOpenPreviewUrl,
  onPickAttachmentFiles,
}: ConversationSurfaceProps): React.ReactNode {
  const composerRef = useRef<ComposerHandle | null>(null);
  // Only the signed-out cue matters mid-session (the next turn would fail on auth); a missing or
  // unverified CLI stays a new-session concern — this session's process is already running.
  const cue = agentKind === undefined ? undefined : runtimeCues?.[agentKind];
  const loginCue = cue?.state === 'needs-login' ? cue : undefined;
  const hasPromptCard = selectPendingPromptItems(conversation).length > 0;
  // Artifact interactions (click-to-reference) land in this surface's own composer;
  // the loop stays inside the presentation layer.
  const artifactActions = {
    referenceToComposer: (text: string) => composerRef.current?.insertText(text),
    openFile: onOpenFileArtifact,
    openVideoPreview: onOpenVideoPreview,
    reviewChanges: onReviewChanges,
    hostArtifact: onHostArtifact,
    openPreviewUrl: onOpenPreviewUrl,
  };

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      <div className={cn('min-h-0 flex-1', conversationClassName)}>
        <ArtifactHostActionsProvider actions={artifactActions}>
          <ConversationView
            conversation={conversation}
            agentKind={agentKind}
            cwd={cwd}
            modelName={modelName ?? conversation.currentModel ?? undefined}
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
      <div hidden={hasPromptCard}>
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
          agentModels={conversation.availableModels}
          directiveControls={composer.directiveControls}
          onSend={composer.onSend}
          onStop={composer.onStop}
          onPickAttachmentFiles={onPickAttachmentFiles}
          onModeChange={composer.onModeChange}
          onApprovalPolicyChange={composer.onApprovalPolicyChange}
          onModelChange={composer.onModelChange}
          onEffortChange={composer.onEffortChange}
        />
      </div>
    </div>
  );
}
