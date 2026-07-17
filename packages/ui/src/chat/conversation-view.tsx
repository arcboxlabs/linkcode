import type { AgentKind } from '@linkcode/schema';
import { Spinner } from 'coss-ui/components/spinner';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './conversation';
import { SubagentViewer } from './subagent-viewer';
import { partitionSubagentItems } from './subagents';
import { TurnSegmentView } from './turn-segment-view';
import type { ConversationItem, ConversationViewModel } from './types';
import { useTimelineModel } from './use-timeline-model';

export interface ConversationViewProps {
  conversation: ConversationViewModel;
  agentKind?: AgentKind;
  cwd?: string;
  /** Session-level fallback for the per-turn model meta (a turn's own message stamp wins). */
  modelName?: string;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  /** Opens this turn's workspace changes in the host review surface. */
  onReviewChanges?: () => void;
}

/** The centered message stream — the main reading surface. Auto-follows only while pinned to the bottom. */
export function ConversationView({
  conversation,
  agentKind,
  cwd,
  modelName,
  TerminalBlockComponent,
  onReviewChanges,
}: ConversationViewProps): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const tk = useTranslations('workbench.agentKind');

  // Transient viewer state: which subagent's full transcript is open in the modal (null = closed).
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const { items } = conversation;
  const { segments, declined, snapshottedToolIds, awaitingApproval } =
    useTimelineModel(conversation);

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
  // Conversation-wide view of the same parent→children relation the per-segment partitions see
  // (a subagent never outlives its turn), for the cross-conversation viewer rail.
  const subagentTasks = items.filter(
    (item): item is Extract<ConversationItem, { kind: 'tool' }> =>
      item.kind === 'tool' && item.toolCall.kind === 'task',
  );
  const allSubagentChildren = partitionSubagentItems(items).childrenByParent;

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
        {segments.map((segment, index) => (
          <TurnSegmentView
            key={segment.turnId ?? 'lead-in'}
            segment={segment}
            // Trailers appear once the turn has settled — the in-flight turn shows none.
            ended={index < segments.length - 1 || !isThinking}
            agentKind={agentKind}
            modelName={modelName}
            declined={declined}
            snapshottedToolIds={snapshottedToolIds}
            awaitingApproval={awaitingApproval}
            TerminalBlockComponent={TerminalBlockComponent}
            onExpandTask={setExpandedTaskId}
            onReviewChanges={onReviewChanges}
          />
        ))}
        {isThinking && (
          <div className="flex items-center gap-2 py-1 text-muted-foreground text-sm">
            <Spinner className="size-3.5" />
            <span>{t('thinking')}</span>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
      <SubagentViewer
        awaitingApproval={awaitingApproval}
        childrenByParent={allSubagentChildren}
        declined={declined}
        onOpenChange={(open) => {
          if (!open) setExpandedTaskId(null);
        }}
        onSelect={setExpandedTaskId}
        open={expandedTaskId !== null}
        selectedId={expandedTaskId}
        tasks={subagentTasks}
        TerminalBlockComponent={TerminalBlockComponent}
      />
    </Conversation>
  );
}
