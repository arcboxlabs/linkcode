import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import {
  BrainIcon,
  ChevronRightIcon,
  CircleXIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { ActivitySummaryCategory, ActivitySummaryClause } from './activity-summary';
import { activityRunCurrentDescriptor, settledActivityRunDescriptor } from './activity-summary';
import { ThoughtBlock } from './thought-block';
import { ToolCallItem } from './tool-call-item';
import type { ConversationItem } from './types';

type ReasoningActivityItem = Extract<ConversationItem, { kind: 'reasoning' }>;
type ToolActivityItem = Extract<ConversationItem, { kind: 'tool' }>;
type ActivityRunItem =
  | ReasoningActivityItem
  | (ToolActivityItem & {
      toolCall: ToolActivityItem['toolCall'] & {
        kind: Exclude<ToolActivityItem['toolCall']['kind'], 'task'>;
      };
    });

export type ActivityRunEntry = { type: 'run'; id: string; items: ActivityRunItem[] };

/** One terse, user-controlled disclosure for a contiguous burst of reasoning and tool activity. */
export function ActivityRun({
  run,
  awaitingApproval,
  declined,
  TerminalBlockComponent,
}: {
  run: ActivityRunEntry;
  awaitingApproval: ReadonlySet<string>;
  declined: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.activityRun');
  const current = activityRunCurrentDescriptor(run.items);
  const settled = settledActivityRunDescriptor(run.items);
  const hasFailure = settled.clauses.some((clause) => clause.category === 'failure');
  const summaryClauses = current
    ? [
        {
          key: `running-${current.kind}`,
          text: withDetail(t(`running.${current.kind}`), current.detail),
          failure: false,
        },
        ...(hasFailure ? [{ key: 'failure', text: t('failed'), failure: true }] : []),
      ]
    : settled.clauses.map((clause) =>
        clause.category === 'failure'
          ? { key: clause.category, text: t('failed'), failure: true }
          : {
              key: clause.category,
              text: withDetail(t(`settled.${clause.category}`), clause.detail),
              failure: false,
            },
      );
  const label = summaryClauses.map((clause) => clause.text).join(' · ');
  const primaryCategory = primarySettledCategory(settled.clauses);
  const [open, setOpen] = useState(false);

  return (
    <Collapsible className="w-full" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        aria-label={t('ariaLabel', { label })}
        className="group flex w-full items-center gap-2 py-1 text-left text-sm"
      >
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        <ActivityRunIcon
          category={primaryCategory}
          failed={hasFailure}
          running={current !== undefined}
        />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {summaryClauses.map((clause, index) => (
            <span
              className={clause.failure ? 'text-destructive-foreground' : undefined}
              key={clause.key}
            >
              {index > 0 ? ' · ' : null}
              {clause.text}
            </span>
          ))}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5">
        {run.items.map((item) =>
          item.kind === 'reasoning' ? (
            <ThoughtBlock key={item.id} blocks={item.blocks} isStreaming={item.isStreaming} />
          ) : (
            <ToolCallItem
              key={item.id}
              awaitingApproval={awaitingApproval.has(item.toolCall.toolCallId)}
              declined={declined.has(item.toolCall.toolCallId)}
              toolCall={item.toolCall}
              TerminalBlockComponent={TerminalBlockComponent}
            />
          ),
        )}
      </CollapsibleContent>
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
  thinking: BrainIcon,
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
  if (running) return <Spinner className="size-3.5 shrink-0 text-foreground" />;
  if (failed) return <CircleXIcon className="size-3.5 shrink-0 text-destructive-foreground" />;
  const Icon = category ? ACTIVITY_ICONS[category] : WrenchIcon;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

function withDetail(label: string, detail?: string): string {
  return detail ? `${label} · ${detail}` : label;
}

function primarySettledCategory(
  clauses: readonly ActivitySummaryClause[],
): SettledActivityCategory | undefined {
  for (const clause of clauses) {
    if (clause.category !== 'failure') return clause.category;
  }
  return undefined;
}
