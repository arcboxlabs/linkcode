import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import { ChevronRightIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { ActivityEntry } from './activity-groups';
import { hasToolBody, ToolCallBody } from './tool-call-item';

export type ActivityToolGroup = Extract<ActivityEntry, { type: 'group' }>;

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

  // Forced open while a call is in flight (Codex's active cell); the user's toggle takes over after.
  const [manualOpen, setManualOpen] = useState(false);
  const open = hasRunning || manualOpen;

  return (
    <Collapsible className="w-full" onOpenChange={setManualOpen} open={open}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-muted">
        <ActivityStatusIcon failed={failedCount > 0} running={hasRunning} />
        <span className="shrink-0 text-foreground">{t(group.bucket)}</span>
        <Badge size="sm" variant="secondary">
          {group.items.length}
        </Badge>
        {failedCount > 0 ? (
          <Badge size="sm" variant="error">
            {t('failed', { count: failedCount })}
          </Badge>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
          {open ? '' : group.items.map((item) => item.toolCall.title).join(', ')}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-1 space-y-0.5 border-l-2 border-border pl-3">
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

function ActivityStatusIcon({
  running,
  failed,
}: {
  running: boolean;
  failed: boolean;
}): React.ReactNode {
  if (running) return <Spinner className="size-4 text-foreground" />;
  if (failed) return <CircleXIcon className="size-4 text-destructive-foreground" />;
  return <CircleCheckIcon className="size-4 text-success-foreground" />;
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
    'truncate px-1.5 py-0.5 text-left text-sm',
    toolCall.status === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
  );

  if (!hasToolBody(toolCall)) {
    return <div className={titleClassName}>{toolCall.title}</div>;
  }

  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          titleClassName,
          'block w-full rounded-md hover:bg-muted hover:text-foreground',
        )}
      >
        {toolCall.title}
      </CollapsibleTrigger>
      <CollapsibleContent className="my-1 space-y-2 pl-1.5">
        <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
      </CollapsibleContent>
    </Collapsible>
  );
}
