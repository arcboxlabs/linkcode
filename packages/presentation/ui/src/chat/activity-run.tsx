import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { PencilIcon, SearchIcon, SparklesIcon, TerminalIcon, WrenchIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { TimelineEntry } from './activity-groups';
import type { ActivitySummaryCategory, ActivitySummaryClause } from './activity-summary';
import { activityRunCurrentDescriptor, settledActivityRunDescriptor } from './activity-summary';
import type { QuestionConversationItem } from './conversation-prompts';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import { QuestionCallItem } from './question-call-item';
import { Shimmer } from './shimmer';
import { ThoughtBlock } from './thought-block';
import { ToolCallItem } from './tool-call-item';

export type ActivityRunEntry = Extract<TimelineEntry, { type: 'run' }>;

const EXACT_ACTIVITY_COUNT_MAX = 10;

/** One terse, user-controlled disclosure for a contiguous burst of reasoning and tool activity. */
export function ActivityRun({
  run,
  awaitingApproval,
  awaitingAnswer,
  questionsByToolCall,
  declined,
  TerminalBlockComponent,
}: {
  run: ActivityRunEntry;
  awaitingApproval: ReadonlySet<string>;
  awaitingAnswer: ReadonlySet<string>;
  questionsByToolCall: ReadonlyMap<string, QuestionConversationItem>;
  declined: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.activityRun');
  const current = activityRunCurrentDescriptor(run.items);
  const settled = settledActivityRunDescriptor(run.items);
  const firstClause = settled.clauses[0];
  const failureClause = firstClause.category === 'failure' ? firstClause : undefined;
  const hasFailure = failureClause !== undefined;
  const clauseText = (clause: ActivitySummaryClause): string => {
    if (clause.category === 'thinking') return t('settled.thinking');
    if (clause.category === 'failure') {
      return clause.count <= EXACT_ACTIVITY_COUNT_MAX
        ? t('failed', { count: clause.count })
        : t('failedMany');
    }
    return clause.count <= EXACT_ACTIVITY_COUNT_MAX
      ? t(`settled.${clause.category}`, { count: clause.count })
      : t(`settledMany.${clause.category}`);
  };
  const currentSummary = current && 'summary' in current ? current.summary : undefined;
  const summaryClauses = current
    ? [
        {
          key: `running-${current.kind}`,
          text: t(`running.${current.kind}`),
          failure: false,
        },
        ...(currentSummary
          ? [{ key: 'running-summary', text: currentSummary, failure: false }]
          : []),
        ...(failureClause
          ? [{ key: 'failure', text: clauseText(failureClause), failure: true }]
          : []),
      ]
    : settled.clauses.map((clause) =>
        clause.category === 'failure'
          ? { key: clause.category, text: clauseText(clause), failure: true }
          : { key: clause.category, text: clauseText(clause), failure: false },
      );
  const label = summaryClauses.map((clause) => clause.text).join(' · ');
  const leadingClause = summaryClauses[0];
  const lastClause = summaryClauses.at(-1);
  const trailingFailure = current && lastClause?.failure ? lastClause : undefined;
  const secondaryClauses = summaryClauses.slice(1).filter((clause) => clause !== trailingFailure);
  const primaryCategory =
    primarySettledCategory(settled.clauses) ??
    (run.items.some((item) => item.kind === 'reasoning' || item.toolCall.kind === 'think')
      ? 'thinking'
      : undefined);
  const iconCategory = current?.category ?? primaryCategory;
  const [open, setOpen] = useState(false);

  return (
    <Collapsible className="w-full" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        aria-label={t('ariaLabel', { label })}
        className={`${CHAT_DISCLOSURE_TRIGGER_CLASS_NAME} w-full`}
      >
        <ChatDisclosureIconSlot>
          <ActivityRunIcon
            category={iconCategory}
            failed={hasFailure}
            running={current !== undefined}
          />
        </ChatDisclosureIconSlot>
        <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
          <span
            className={cn(
              CHAT_DISCLOSURE_TITLE_CLASS_NAME,
              leadingClause.failure && 'text-destructive-foreground opacity-100',
            )}
          >
            {current ? <Shimmer>{leadingClause.text}</Shimmer> : leadingClause.text}
          </span>
          {secondaryClauses.length > 0 ? (
            <span className="min-w-0 shrink truncate">
              {secondaryClauses.map((clause) => (
                <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME} key={clause.key}>
                  {' · '}
                  {current ? <Shimmer>{clause.text}</Shimmer> : clause.text}
                </span>
              ))}
            </span>
          ) : null}
        </span>
        {trailingFailure ? (
          <span
            className={cn(
              CHAT_DISCLOSURE_TITLE_CLASS_NAME,
              'text-destructive-foreground opacity-100',
            )}
          >
            {' · '}
            {trailingFailure.text}
          </span>
        ) : null}
        <ChatDisclosureChevron />
      </CollapsibleTrigger>
      <ChatDisclosureContent bodyClassName="space-y-0.5">
        {run.items.map((item) => {
          if (item.kind === 'reasoning') {
            return (
              <ThoughtBlock
                key={item.id}
                blocks={item.blocks}
                endedAt={item.endedAt}
                isStreaming={item.isStreaming}
                startedAt={item.startedAt}
                summary={item.summary}
                constrainHeight={false}
              />
            );
          }
          const question = questionsByToolCall.get(item.toolCall.toolCallId);
          if (question) {
            return (
              <QuestionCallItem
                key={item.id}
                awaitingAnswer={awaitingAnswer.has(item.toolCall.toolCallId)}
                question={question}
                toolCall={item.toolCall}
                constrainHeight={false}
              />
            );
          }
          return (
            <ToolCallItem
              key={item.id}
              awaitingApproval={awaitingApproval.has(item.toolCall.toolCallId)}
              awaitingAnswer={awaitingAnswer.has(item.toolCall.toolCallId)}
              declined={declined.has(item.toolCall.toolCallId)}
              toolCall={item.toolCall}
              TerminalBlockComponent={TerminalBlockComponent}
              constrainHeight={false}
            />
          );
        })}
      </ChatDisclosureContent>
    </Collapsible>
  );
}

type SettledActivityCategory = Exclude<ActivitySummaryCategory, 'failure'>;

const ACTIVITY_ICONS: Record<
  SettledActivityCategory,
  React.ComponentType<{ className?: string }>
> = {
  files: PencilIcon,
  integration: WrenchIcon,
  command: TerminalIcon,
  explore: SearchIcon,
  thinking: SparklesIcon,
};

function ActivityRunIcon({
  category,
  failed,
  running,
}: {
  category?: SettledActivityCategory;
  failed: boolean;
  running: boolean;
}): React.ReactNode {
  // The shimmering label already signals activity, so a running head keeps its category
  // glyph (no spinner) and only brightens it.
  const Icon = category ? ACTIVITY_ICONS[category] : WrenchIcon;
  if (failed) return <Icon className="size-3.5 shrink-0 text-destructive-foreground" />;
  if (running) return <Icon className="size-3.5 shrink-0 text-foreground" />;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

function primarySettledCategory(
  clauses: readonly ActivitySummaryClause[],
): SettledActivityCategory | undefined {
  for (const clause of clauses) {
    if (clause.category !== 'failure') return clause.category;
  }
  return undefined;
}
