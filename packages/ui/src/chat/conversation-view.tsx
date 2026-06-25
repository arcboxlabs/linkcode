import type { AgentKind } from '@linkcode/schema';
import { Spinner } from 'coss-ui/components/spinner';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './conversation';
import { ErrorMessage } from './error-message';
import { Message, MessageContent } from './message';
import { PermissionCard } from './permission-card';
import { PlanCard } from './plan-card';
import { ThoughtBlock } from './thought-block';
import { ToolCallItem } from './tool-call-item';
import type { ConversationViewModel } from './types';

export interface ConversationViewProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  cwd?: string;
  /** requestIds the user already answered in this client. */
  answeredPermissions: Set<string>;
  /** requestIds currently being sent to the daemon. */
  respondingPermissions: Set<string>;
  /** requestIds still awaiting a decision (from the normalizer); others are treated as resolved. */
  pendingPermissions: Set<string>;
  onRespondPermission: (requestId: string, optionId: string) => void;
}

/** The centered message stream — the main reading surface. Auto-follows only while pinned to the bottom. */
export function ConversationView({
  conversation,
  agentKind,
  cwd,
  answeredPermissions,
  respondingPermissions,
  pendingPermissions,
  onRespondPermission,
}: ConversationViewProps): ReactNode {
  const t = useTranslations('workbench.conversation');
  const tk = useTranslations('workbench.agentKind');

  const { items } = conversation;

  if (items.length === 0) {
    return (
      <ConversationEmptyState
        title={t('emptyTitle')}
        description={t('emptyHint', {
          agent: agentKind ? tk(agentKind) : 'agent',
          cwd: cwd ?? '.',
        })}
      />
    );
  }

  const isThinking = conversation.status === 'running' || conversation.status === 'starting';

  return (
    <Conversation
      style={{
        maskImage:
          'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 16px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, black 24px, black calc(100% - 16px), transparent 100%)',
      }}
    >
      <ConversationContent>
        {items.map((item) => {
          switch (item.kind) {
            case 'message':
              return (
                <Message key={item.id} from={item.role}>
                  <MessageContent className={item.role === 'assistant' ? 'space-y-1' : undefined}>
                    {keyedItems(item.blocks, stableContentKey).map(({ key, item: block }) => (
                      <ContentBlockView key={key} block={block} />
                    ))}
                  </MessageContent>
                </Message>
              );
            case 'reasoning':
              return (
                <ThoughtBlock key={item.id} blocks={item.blocks} isStreaming={item.isStreaming} />
              );
            case 'tool':
              return <ToolCallItem key={item.id} toolCall={item.toolCall} />;
            case 'plan':
              return <PlanCard key={item.id} plan={item.plan} />;
            case 'approval':
              return (
                <PermissionCard
                  key={item.id}
                  toolCall={item.toolCall}
                  options={item.options}
                  answered={
                    answeredPermissions.has(item.requestId) ||
                    !pendingPermissions.has(item.requestId)
                  }
                  responding={respondingPermissions.has(item.requestId)}
                  onRespond={(optionId) => onRespondPermission(item.requestId, optionId)}
                />
              );
            case 'client-request':
              return (
                <div key={item.id} className="font-mono text-[12px] text-muted-foreground">
                  ⏵ {item.request.method}
                </div>
              );
            case 'error':
              return (
                <ErrorMessage
                  key={item.id}
                  message={item.message}
                  code={item.code}
                  recoverable={item.recoverable}
                />
              );
            default:
              return null;
          }
        })}
        {isThinking && (
          <div className="flex items-center gap-2 py-1 text-muted-foreground text-[13px]">
            <Spinner className="size-3.5" />
            <span>{t('thinking')}</span>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
