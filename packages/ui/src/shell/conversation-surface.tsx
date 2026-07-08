import type { AgentKind, EffortLevel, QuestionOutcome } from '@linkcode/schema';
import { useRef } from 'react';
import { ArtifactHostActionsProvider } from '../chat/artifacts';
import type { PermissionDecision } from '../chat/conversation-prompts';
import { ConversationView } from '../chat/conversation-view';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';
import type { ComposerHandle } from './composer';
import { Composer } from './composer';
import { ConversationPromptDock } from './conversation-prompt-dock';

export interface ConversationSurfaceProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  agentLabel?: string;
  cwd?: string;
  /** TODO(backend): thread the session's active model here once the daemon reflects it. */
  modelName?: string;
  permissionDecisions: ReadonlyMap<string, PermissionDecision>;
  respondingPermissions: ReadonlySet<string>;
  answeredQuestionIds: ReadonlySet<string>;
  respondingQuestions: ReadonlySet<string>;
  disabled?: boolean;
  isRunning: boolean;
  topContent?: React.ReactNode;
  className?: string;
  conversationClassName?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
  /** Opens a produced-file artifact in the shell's viewer (desktop right panel). Absent
   * when the shell has no viewer — file cards then render without the open affordance. */
  onOpenFileArtifact?: (path: string) => void;
  /** Hosts inline content on the daemon's ephemeral origin (sandboxed html previews). */
  onHostArtifact?: (content: string, mimeType: string) => Promise<{ url: string }>;
  /** Promotes a hosted/preview URL to the shell's browser surface; default: new tab. */
  onOpenPreviewUrl?: (url: string) => void;
  onModeChange?: (modeId: string) => Promise<void>;
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
}

export function ConversationSurface({
  conversation,
  agentKind,
  agentLabel,
  cwd,
  modelName,
  permissionDecisions,
  respondingPermissions,
  answeredQuestionIds,
  respondingQuestions,
  disabled = false,
  isRunning,
  topContent,
  className,
  conversationClassName,
  TerminalBlockComponent,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onRespondQuestion,
  onOpenFileArtifact,
  onHostArtifact,
  onOpenPreviewUrl,
  onModeChange,
  onApprovalPolicyChange,
  onModelChange,
  onEffortChange,
}: ConversationSurfaceProps): React.ReactNode {
  const composerRef = useRef<ComposerHandle | null>(null);
  // Artifact interactions (click-to-reference) land in this surface's own composer;
  // the loop stays inside the presentation layer.
  const artifactActions = {
    referenceToComposer: (text: string) => composerRef.current?.insertText(text),
    openFile: onOpenFileArtifact,
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
            permissionDecisions={permissionDecisions}
            TerminalBlockComponent={TerminalBlockComponent}
          />
        </ArtifactHostActionsProvider>
      </div>
      <ConversationPromptDock
        conversation={conversation}
        permissionDecisions={permissionDecisions}
        respondingPermissions={respondingPermissions}
        answeredQuestionIds={answeredQuestionIds}
        respondingQuestions={respondingQuestions}
        onRespondPermission={onRespondPermission}
        onRespondQuestion={onRespondQuestion}
      />
      {/* TODO(backend): pass the agent-advertised mode list (session-modes.ts) once the daemon
          emits it; the composer stubs the workflow-mode list today. */}
      <Composer
        handleRef={composerRef}
        agentLabel={agentLabel}
        agentKind={agentKind}
        disabled={disabled}
        isRunning={isRunning}
        currentModeId={conversation.currentModeId}
        approvalPolicy={conversation.approvalPolicy}
        currentModel={conversation.currentModel}
        currentEffort={conversation.currentEffort}
        onSend={onSendPrompt}
        onStop={onStopTurn}
        onModeChange={onModeChange}
        onApprovalPolicyChange={onApprovalPolicyChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    </div>
  );
}
