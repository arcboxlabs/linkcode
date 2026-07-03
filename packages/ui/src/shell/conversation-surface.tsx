import type { AgentKind, EffortLevel } from '@linkcode/schema';
import { ConversationView } from '../chat/conversation-view';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';
import { Composer } from './composer';

export interface ConversationSurfaceProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  agentLabel?: string;
  cwd?: string;
  answeredPermissions: Set<string>;
  respondingPermissions: Set<string>;
  disabled?: boolean;
  isRunning: boolean;
  topContent?: React.ReactNode;
  className?: string;
  conversationClassName?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
  onModeChange?: (modeId: string) => Promise<void>;
  onModelChange?: (model: string) => Promise<void>;
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
}

export function ConversationSurface({
  conversation,
  agentKind,
  agentLabel,
  cwd,
  answeredPermissions,
  respondingPermissions,
  disabled = false,
  isRunning,
  topContent,
  className,
  conversationClassName,
  TerminalBlockComponent,
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
  onModeChange,
  onModelChange,
  onEffortChange,
  onApprovalPolicyChange,
}: ConversationSurfaceProps): React.ReactNode {
  // The approval-policy axis rides the conversation view-model; the schema state maps onto the
  // composer's view-model options here so the chat layer stays schema-typed end to end.
  const approvalPolicies =
    conversation.approvalPolicy?.availablePolicies.map((policy) => ({
      id: policy.policyId,
      name: policy.name,
      description: policy.description,
    })) ?? [];
  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      {topContent}
      <div className={cn('min-h-0 flex-1', conversationClassName)}>
        <ConversationView
          conversation={conversation}
          agentKind={agentKind}
          cwd={cwd}
          answeredPermissions={answeredPermissions}
          respondingPermissions={respondingPermissions}
          pendingPermissions={new Set(conversation.pendingPermissionIds)}
          TerminalBlockComponent={TerminalBlockComponent}
          onRespondPermission={onRespondPermission}
        />
      </div>
      {/* TODO(backend): pass the agent-advertised mode list (session-modes.ts) once the daemon
          emits it; the composer stubs that list today. */}
      <Composer
        agentLabel={agentLabel}
        agentKind={agentKind}
        disabled={disabled}
        isRunning={isRunning}
        currentModeId={conversation.currentModeId}
        approvalPolicies={approvalPolicies}
        activePolicyId={conversation.approvalPolicy?.currentPolicyId ?? null}
        onSend={onSendPrompt}
        onStop={onStopTurn}
        onModeChange={onModeChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
        onApprovalPolicyChange={onApprovalPolicyChange}
      />
    </div>
  );
}
