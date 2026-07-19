import type { AgentKind } from '@linkcode/schema';
import { cn } from '../lib/cn';
import { ActivityGroup } from './activity-group';
import type { TimelineEntry } from './activity-groups';
import { groupTimeline } from './activity-groups';
import { CompactionMarker } from './compaction-marker';
import { ContentBlockView } from './content-block-view';
import { positionalBlockEntries } from './content-derived-keys';
import { declinedToolCall } from './conversation-prompts';
import { assistantTurnText, latestReceivedAt, turnModel } from './conversation-text';
import { ErrorMessage } from './error-message';
import { Message, MessageContent } from './message';
import { SubagentCard } from './subagent-card';
import { partitionSubagentItems } from './subagents';
import { ThoughtBlock } from './thought-block';
import { ToolCallItem } from './tool-call-item';
import { AgentTurnActions } from './turn-actions';
import { TurnDiffSummary } from './turn-diff-summary';
import type { TurnSegment } from './turn-edits';
import { turnFileEdits } from './turn-edits';
import { UserMessage } from './user-message';

export interface TurnSegmentViewProps {
  segment: TurnSegment;
  /** First row of the timeline — carries the column's top padding (rows own vertical spacing). */
  first: boolean;
  /** Whether the turn has settled — trailers (edit rollup, reply actions) appear only then. */
  ended: boolean;
  agentKind?: AgentKind;
  /** Session-level fallback for the per-turn model meta (a turn's own message stamp wins). */
  modelName?: string;
  declined: ReadonlySet<string>;
  snapshottedToolIds: ReadonlySet<string>;
  awaitingApproval: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  /** Opens a subagent's full transcript in the conversation's viewer rail. */
  onExpandTask: (toolCallId: string) => void;
  /** Opens this turn's workspace changes in the host review surface. */
  onReviewChanges?: () => void;
}

/**
 * One turn of the timeline: the opening user message plus the agent's activity and trailers.
 * Props stay identity-stable for settled turns (see useTimelineModel), so re-renders during
 * streaming reach only the active turn.
 */
export function TurnSegmentView({
  segment,
  first,
  ended,
  agentKind,
  modelName,
  declined,
  snapshottedToolIds,
  awaitingApproval,
  TerminalBlockComponent,
  onExpandTask,
  onReviewChanges,
}: TurnSegmentViewProps): React.ReactNode {
  // Children leave the top-level timeline (they render inside their SubagentCard), but the
  // turn's edit rollup still counts them; the copyable reply text is the main agent's only.
  const { topLevel, childrenByParent } = partitionSubagentItems(segment.items);
  const edits = ended ? turnFileEdits(segment.items) : null;
  const replyText = ended ? assistantTurnText(topLevel) : '';
  const entries = groupTimeline(topLevel);
  const leadingUserEntry =
    entries[0]?.type === 'item' &&
    entries[0].item.kind === 'message' &&
    entries[0].item.role === 'user'
      ? entries[0]
      : null;
  const agentEntries = leadingUserEntry ? entries.slice(1) : entries;
  const hasAgentTurnContent = agentEntries.length > 0 || edits || replyText;

  const renderEntry = (entry: TimelineEntry): React.ReactNode => {
    if (entry.type === 'task') {
      return (
        <SubagentCard
          key={entry.item.id}
          awaitingApproval={awaitingApproval}
          childrenByParent={childrenByParent}
          declined={declined}
          items={childrenByParent.get(entry.item.toolCall.toolCallId) ?? []}
          onExpand={onExpandTask}
          TerminalBlockComponent={TerminalBlockComponent}
          toolCall={entry.item.toolCall}
        />
      );
    }
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
              {positionalBlockEntries(item.blocks).map(({ block, key }) => (
                <ContentBlockView
                  key={key}
                  block={block}
                  smoothText
                  isStreaming={item.isStreaming}
                />
              ))}
            </MessageContent>
          </Message>
        );
      case 'reasoning':
        return <ThoughtBlock key={item.id} blocks={item.blocks} isStreaming={item.isStreaming} />;
      case 'compaction':
        return (
          <CompactionMarker
            key={item.id}
            inProgress={item.status === 'in_progress'}
            startedAt={item.receivedAt}
            preTokens={item.preTokens}
            postTokens={item.postTokens}
            summary={item.summary}
          />
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
  };

  return (
    // Rows own their top spacing (virtua positions them absolutely, so column gap can't).
    // Layout containment keeps one row's reflow from invalidating its mounted siblings.
    <div className={cn('flex flex-col gap-4 [contain:layout_style]', first ? 'pt-6' : 'pt-4')}>
      {leadingUserEntry ? renderEntry(leadingUserEntry) : null}
      {hasAgentTurnContent ? (
        <div className="group/turn flex flex-col gap-3">
          {agentEntries.map((entry) => renderEntry(entry))}
          {edits ? <TurnDiffSummary edits={edits} onReview={onReviewChanges} /> : null}
          {replyText ? (
            <AgentTurnActions
              agentKind={agentKind}
              copyText={replyText}
              modelName={turnModel(segment.items) ?? modelName}
              receivedAt={latestReceivedAt(segment.items)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
