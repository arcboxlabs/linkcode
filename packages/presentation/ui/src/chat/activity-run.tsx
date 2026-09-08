import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { PencilIcon, SparklesIcon, TelescopeIcon, TerminalIcon, WrenchIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { TimelineEntry } from './activity-groups';
import type { ActivitySummaryCategory, ActivitySummaryClause } from './activity-summary';
import {
  activityRunBrand,
  activityRunCurrentDescriptor,
  settledActivityRunDescriptor,
} from './activity-summary';
import type { QuestionConversationItem } from './conversation-prompts';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import type { IntegrationBrand } from './integration-brand';
import { INTEGRATION_LABELS, IntegrationIcon } from './integration-brand';
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
  const brand = activityRunBrand(run.items);
  const brandLabel = brand === undefined ? undefined : INTEGRATION_LABELS[brand];
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
    // A dedicated brand group names its integration ("Used Linear 2 times").
    if (brandLabel !== undefined && clause.category === 'integration') {
      return clause.count <= EXACT_ACTIVITY_COUNT_MAX
        ? t('settled.integrationBrand', { brand: brandLabel, count: clause.count })
        : t('settledMany.integrationBrand', { brand: brandLabel });
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
          text:
            brandLabel !== undefined && current.kind === 'other'
              ? t('running.integrationBrand', { brand: brandLabel })
              : t(`running.${current.kind}`),
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
            brand={brand}
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
      <ChatDisclosureContent bodyClassName="space-y-0.5 [&>[data-slot=collapsible]>*:first-child]:py-0.5">
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
  explore: TelescopeIcon,
  thinking: SparklesIcon,
};

function ActivityRunIcon({
  brand,
  category,
  failed,
  running,
}: {
  /** A single-brand run wears its integration glyph instead of the category glyph. */
  brand?: IntegrationBrand;
  category?: SettledActivityCategory;
  failed: boolean;
  running: boolean;
}): React.ReactNode {
  // The shimmering label already signals activity, so a running head keeps its category
  // glyph (no spinner) and only brightens it.
  const tint = failed
    ? 'text-destructive-foreground'
    : running
      ? 'text-foreground'
      : 'text-muted-foreground';
  // A brand glyph persists through failure (the red failure clause carries the state) but
  // never wears the destructive tint — a red Linear logo reads as the integration itself
  // being broken.
  if (brand) {
    return <IntegrationIcon brand={brand} className={failed ? 'text-muted-foreground' : tint} />;
  }
  const Icon = category ? ACTIVITY_ICONS[category] : WrenchIcon;
  return <Icon className={cn('size-3.5 shrink-0', tint)} />;
}

function primarySettledCategory(
  clauses: readonly ActivitySummaryClause[],
): SettledActivityCategory | undefined {
  for (let i = 0, len = clauses.length; i < len; i++) {
    const clause = clauses[i];
    if (clause.category !== 'failure') return clause.category;
  }
  return undefined;
}
