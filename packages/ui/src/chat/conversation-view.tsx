import type { AgentKind, PermissionOption } from '@linkcode/schema';
import { Spinner } from 'coss-ui/components/spinner';
import { Fragment } from 'react';
import { useTranslations } from 'use-intl';
import { ActivityGroup } from './activity-group';
import type { TimelineEntry } from './activity-groups';
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
  selectPendingPermissionItems,
} from './conversation-prompts';
import { assistantTurnText, latestReceivedAt } from './conversation-text';
import { ErrorMessage } from './error-message';
import { Message, MessageContent } from './message';
import { ThoughtBlock } from './thought-block';
import { ToolCallItem } from './tool-call-item';
import { AgentTurnActions } from './turn-actions';
import { TurnDiffSummary } from './turn-diff-summary';
import { splitTurnSegments, turnFileEdits } from './turn-edits';
import type { ConversationViewModel } from './types';
import { UserMessage } from './user-message';

export interface ConversationViewProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  cwd?: string;
  /** TODO(backend): shown in the per-turn meta once session state reflects the active model. */
  modelName?: string;
  /** requestIds and selected options answered in this client. */
  permissionDecisions: ReadonlyMap<string, PermissionOption>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}

/** The centered message stream — the main reading surface. Auto-follows only while pinned to the bottom. */
export function ConversationView({
  conversation,
  agentKind,
  cwd,
  modelName,
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
  // Gated calls whose ask is still open (not answered in this client) carry the shield glyph.
  const awaitingApproval = new Set(
    selectPendingPermissionItems(conversation).flatMap((item) =>
      permissionDecisions.has(item.requestId) ? [] : [item.toolCall.toolCallId],
    ),
  );
  const segments = splitTurnSegments(conversationFlowItems(items));

  const renderEntry = (entry: TimelineEntry): React.ReactNode => {
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
          awaitingApproval={awaitingApproval.has(entry.item.toolCall.toolCallId)}
          declined={declined.has(entry.item.toolCall.toolCallId)}
          toolCall={entry.item.toolCall}
          TerminalBlockComponent={TerminalBlockComponent}
        />
      );
    }
    const item = entry.item;
    switch (item.kind) {
      case 'message':
        if (item.role === 'user') return <UserMessage key={item.id} item={item} />;
        return (
          <Message key={item.id} from="assistant">
            <MessageContent className="space-y-1">
              {keyedItems(item.blocks, stableContentKey).map(({ key, item: block }) => (
                <ContentBlockView key={key} block={block} />
              ))}
            </MessageContent>
          </Message>
        );
      case 'reasoning':
        return <ThoughtBlock key={item.id} blocks={item.blocks} isStreaming={item.isStreaming} />;
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
  };

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
        {segments.map((segment, index) => {
          // Per-turn trailers (edit rollup, reply actions) appear once the turn has settled —
          // the in-flight turn shows none.
          const ended = index < segments.length - 1 || !isThinking;
          const edits = ended ? turnFileEdits(segment.items) : null;
          const replyText = ended ? assistantTurnText(segment.items) : '';
          const entries = groupTimeline(segment.items);
          const leadingUserEntry =
            entries[0]?.type === 'item' &&
            entries[0].item.kind === 'message' &&
            entries[0].item.role === 'user'
              ? entries[0]
              : null;
          const agentEntries = leadingUserEntry ? entries.slice(1) : entries;
          const hasAgentTurnContent = agentEntries.length > 0 || edits || replyText;
          return (
            <Fragment key={segment.turnId ?? 'lead-in'}>
              {leadingUserEntry ? renderEntry(leadingUserEntry) : null}
              {hasAgentTurnContent ? (
                <div className="group/turn flex flex-col gap-3">
                  {agentEntries.map((entry) => renderEntry(entry))}
                  {edits ? <TurnDiffSummary edits={edits} /> : null}
                  {replyText ? (
                    <AgentTurnActions
                      agentKind={agentKind}
                      copyText={replyText}
                      modelName={modelName}
                      receivedAt={latestReceivedAt(segment.items)}
                    />
                  ) : null}
                </div>
              ) : null}
            </Fragment>
          );
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
