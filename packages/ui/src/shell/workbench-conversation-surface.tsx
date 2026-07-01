import type { AgentKind } from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationView } from '../chat';
import { cn } from '../lib/cn';
import { Composer } from './composer';

export interface WorkbenchConversationSurfaceProps {
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
  onSendPrompt: (text: string) => void;
  onStopTurn: () => void;
  onRespondPermission: (requestId: string, optionId: string) => void;
}

export function WorkbenchConversationSurface({
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
  onSendPrompt,
  onStopTurn,
  onRespondPermission,
}: WorkbenchConversationSurfaceProps): React.ReactNode {
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
          onRespondPermission={onRespondPermission}
        />
      </div>
      <Composer
        agentLabel={agentLabel}
        disabled={disabled}
        isRunning={isRunning}
        currentModeId={conversation.currentModeId}
        onSend={onSendPrompt}
        onStop={onStopTurn}
      />
    </div>
  );
}
