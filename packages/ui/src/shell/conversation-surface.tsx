import type { AgentKind, EffortLevel } from '@linkcode/schema';
import type { ConversationViewModel } from '../chat';
import { ConversationView } from '../chat';
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
}: ConversationSurfaceProps): React.ReactNode {
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
      {/* TODO(linkcode-schema): pass `availableModes` from the conversation view-model once the
          backend emits the agent's SessionModeState; the composer falls back to a stub list. */}
      <Composer
        agentLabel={agentLabel}
        agentKind={agentKind}
        disabled={disabled}
        isRunning={isRunning}
        currentModeId={conversation.currentModeId}
        onSend={onSendPrompt}
        onStop={onStopTurn}
        onModeChange={onModeChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />
    </div>
  );
}
