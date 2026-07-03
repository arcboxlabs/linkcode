import type { AgentKind, PermissionOption } from '@linkcode/schema';
import { Spinner } from 'coss-ui/components/spinner';
import { useTranslations } from 'use-intl';
import { ActivityGroup } from './activity-group';
import { groupTimeline } from './activity-groups';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './conversation';
import {
  conversationFlowItems,
  declinedToolCall,
  declinedToolCallIds,
} from './conversation-prompts';
import { ErrorMessage } from './error-message';
import { Message, MessageContent } from './message';
import { ThoughtBlock } from './thought-block';
import { ToolCallItem } from './tool-call-item';
import type { ConversationViewModel } from './types';

export interface ConversationViewProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  cwd?: string;
  /** requestIds and selected options answered in this client. */
  permissionDecisions: ReadonlyMap<string, PermissionOption>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}

/** The centered message stream — the main reading surface. Auto-follows only while pinned to the bottom. */
export function ConversationView({
  conversation,
  agentKind,
  cwd,
  permissionDecisions,
  TerminalBlockComponent,
}: ConversationViewProps): React.ReactNode {
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
  // Permission asks live above the composer; the flow only marks declines, on the gated tool row.
  const declined = declinedToolCallIds(items, permissionDecisions);
  const snapshottedToolIds = new Set(
    items.flatMap((item) => (item.kind === 'tool' ? [item.toolCall.toolCallId] : [])),
  );

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
        {groupTimeline(conversationFlowItems(items)).map((entry) => {
          if (entry.type === 'group') {
            return (
              <ActivityGroup
                key={entry.id}
                group={entry}
                TerminalBlockComponent={TerminalBlockComponent}
              />
            );
          }
          if (entry.type === 'single') {
            return (
              <ToolCallItem
                key={entry.item.id}
                declined={declined.has(entry.item.toolCall.toolCallId)}
                toolCall={entry.item.toolCall}
                TerminalBlockComponent={TerminalBlockComponent}
              />
            );
          }
          const item = entry.item;
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
            case 'approval':
              // Accepted / pending asks leave no receipt — the tool row (or the dock card) is the
              // record. A decline only materializes here when the agent never snapshotted the call.
              if (
                !declined.has(item.toolCall.toolCallId) ||
                snapshottedToolIds.has(item.toolCall.toolCallId)
              ) {
                return null;
              }
              return (
                <ToolCallItem
                  key={item.id}
                  declined
                  toolCall={declinedToolCall(item.toolCall)}
                  TerminalBlockComponent={TerminalBlockComponent}
                />
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
          <div className="flex items-center gap-2 py-1 text-muted-foreground text-sm">
            <Spinner className="size-3.5" />
            <span>{t('thinking')}</span>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
