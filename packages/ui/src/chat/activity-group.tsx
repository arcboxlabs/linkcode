import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import {
  BrainIcon,
  ChevronRightIcon,
  GlobeIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { ActivityBucket, TimelineEntry } from './activity-groups';
import { DiffCounter } from './diff-block';
import { toolCallDiffStats } from './diff-utils';
import { TOOL_DETAIL_SCROLL_CLASS_NAME } from './tool';
import { ToolCallBody } from './tool-call-item';
import { hasToolBody, toolCallHeaderSummary } from './tool-utils';
import { FilePathTooltip } from './with-tooltip';

export type ActivityToolGroup = Extract<TimelineEntry, { type: 'group' }>;

/** Collapsed audit summary for a burst of same-bucket tool calls ("Explored · 3", "Edited files · 2"). */
export function ActivityGroup({
  group,
  TerminalBlockComponent,
}: {
  group: ActivityToolGroup;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);
  const t = useTranslations('workbench.toolGroup');
  const hasRunning = group.items.some((item) => item.toolCall.status === 'in_progress');
  const failedCount = group.items.reduce(
    (count, item) => count + (item.toolCall.status === 'failed' ? 1 : 0),
    0,
  );
  const diffTotals = group.bucket === 'files' ? sumGroupDiffStats(group) : null;
  const summaries = group.items.map((item) => toolCallHeaderSummary(item.toolCall));
  const summaryTooltip = summaries.flatMap((summary) =>
    summary?.tooltip ? [summary.tooltip] : [],
  );

  // Forced open while a call is in flight (Codex's active cell); the user's toggle takes over after.
  const [manualOpen, setManualOpen] = useState(false);
  const open = hasRunning || manualOpen;

  return (
    <Collapsible className="w-full" onOpenChange={setManualOpen} open={open}>
      <FilePathTooltip
        anchor={tooltipAnchorRef}
        tooltip={!open && summaryTooltip.length > 0 ? summaryTooltip.join(', ') : undefined}
      >
        <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1 text-left text-sm">
          <ActivityBucketIcon bucket={group.bucket} running={hasRunning} />
          <span className="shrink-0 text-foreground">{t(group.bucket)}</span>
          <Badge size="sm" variant="secondary">
            {group.items.length}
          </Badge>
          {failedCount > 0 ? (
            <Badge size="sm" variant="error">
              {t('failed', { count: failedCount })}
            </Badge>
          ) : null}
          {diffTotals ? <DiffCounter stats={diffTotals} /> : null}
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70" ref={tooltipAnchorRef}>
            {open
              ? ''
              : summaries
                  .map((summary, index) => summary?.label ?? group.items[index].toolCall.title)
                  .join(', ')}
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        </CollapsibleTrigger>
      </FilePathTooltip>
      <CollapsibleContent
        className={cn(
          'mt-1 space-y-0.5 border-l-2 border-border pl-3',
          TOOL_DETAIL_SCROLL_CLASS_NAME,
        )}
      >
        {group.items.map((item) => (
          <ActivityGroupRow
            key={item.id}
            TerminalBlockComponent={TerminalBlockComponent}
            toolCall={item.toolCall}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function sumGroupDiffStats(group: ActivityToolGroup): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const item of group.items) {
    const stats = toolCallDiffStats(item.toolCall);
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { additions, deletions };
}

const BUCKET_ICONS: Record<ActivityBucket, React.ComponentType<{ className?: string }>> = {
  explore: SearchIcon,
  command: TerminalIcon,
  fetch: GlobeIcon,
  think: BrainIcon,
  files: PencilIcon,
  other: WrenchIcon,
};

/** The bucket glyph, spinner while a call runs. Failures read via the "N failed" badge, not a cross. */
function ActivityBucketIcon({
  bucket,
  running,
}: {
  bucket: ActivityBucket;
  running: boolean;
}): React.ReactNode {
  if (running) return <Spinner className="size-3.5 text-foreground" />;
  const BucketIcon = BUCKET_ICONS[bucket];
  return <BucketIcon className="size-3.5 text-muted-foreground" />;
}

/** One call inside an expanded group: a bare title row — no icons; failures read via color. */
function ActivityGroupRow({
  toolCall,
  TerminalBlockComponent,
}: {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);
  const summary = toolCallHeaderSummary(toolCall);
  const summaryIsTitle = summary?.label === toolCall.title;
  const titleAnchorRef = summaryIsTitle ? tooltipAnchorRef : undefined;
  const titleClassName = cn(
    'flex min-w-0 items-center py-0.5 text-left text-sm',
    toolCall.status === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
  );
  const label = (
    <>
      <span className="min-w-0 truncate" ref={titleAnchorRef}>
        {toolCall.title}
      </span>
      {summary && !summaryIsTitle ? (
        <>
          {' '}
          <span
            className="ml-1 min-w-0 flex-1 truncate text-muted-foreground/70 text-xs"
            ref={tooltipAnchorRef}
          >
            · {summary.label}
          </span>
        </>
      ) : null}
    </>
  );

  if (!hasToolBody(toolCall)) {
    return (
      <FilePathTooltip anchor={tooltipAnchorRef} tooltip={summary?.tooltip}>
        <div
          className={cn(
            titleClassName,
            summary?.tooltip &&
              'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          tabIndex={summary?.tooltip ? 0 : undefined}
        >
          {label}
        </div>
      </FilePathTooltip>
    );
  }

  return (
    <Collapsible>
      <FilePathTooltip anchor={tooltipAnchorRef} tooltip={summary?.tooltip}>
        <CollapsibleTrigger className={cn(titleClassName, 'w-full hover:text-foreground')}>
          {label}
        </CollapsibleTrigger>
      </FilePathTooltip>
      <CollapsibleContent className="my-1 space-y-2 pl-1.5">
        <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
      </CollapsibleContent>
    </Collapsible>
  );
}
