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
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { ActivityBucket, TimelineEntry } from './activity-groups';
import { diffStats } from './diff-block';
import { hasToolBody, ToolCallBody } from './tool-call-item';

export type ActivityToolGroup = Extract<TimelineEntry, { type: 'group' }>;

/** Collapsed audit summary for a burst of same-bucket tool calls ("Explored · 3", "Edited files · 2"). */
export function ActivityGroup({
  group,
  TerminalBlockComponent,
}: {
  group: ActivityToolGroup;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.toolGroup');
  const hasRunning = group.items.some((item) => item.toolCall.status === 'in_progress');
  const failedCount = group.items.reduce(
    (count, item) => count + (item.toolCall.status === 'failed' ? 1 : 0),
    0,
  );
  const diffTotals = group.bucket === 'files' ? sumGroupDiffStats(group) : null;

  // Forced open while a call is in flight (Codex's active cell); the user's toggle takes over after.
  const [manualOpen, setManualOpen] = useState(false);
  const open = hasRunning || manualOpen;

  return (
    <Collapsible className="w-full" onOpenChange={setManualOpen} open={open}>
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
        {diffTotals && diffTotals.additions + diffTotals.deletions > 0 ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs">
            <span className="text-success-foreground">+{diffTotals.additions}</span>
            <span className="text-destructive-foreground">-{diffTotals.deletions}</span>
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
          {open ? '' : group.items.map((item) => item.toolCall.title).join(', ')}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5 border-l-2 border-border pl-3">
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
    for (const content of item.toolCall.content) {
      if (content.type !== 'diff') continue;
      const stats = diffStats(content.oldText, content.newText);
      additions += stats.additions;
      deletions += stats.deletions;
    }
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
  const titleClassName = cn(
    'truncate py-0.5 text-left text-sm',
    toolCall.status === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
  );

  if (!hasToolBody(toolCall)) {
    return <div className={titleClassName}>{toolCall.title}</div>;
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className={cn(titleClassName, 'block w-full hover:text-foreground')}>
        {toolCall.title}
      </CollapsibleTrigger>
      <CollapsibleContent className="my-1 space-y-2 pl-1.5">
        <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
      </CollapsibleContent>
    </Collapsible>
  );
}
