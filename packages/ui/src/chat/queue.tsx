import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { ScrollArea } from 'coss-ui/components/scroll-area';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleXIcon,
  ClockIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only queue item, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when queued agent operations are emitted by client-core.
export interface ChatQueueItem {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  description?: string;
}

export type QueueProps = ComponentProps<'div'> & {
  items?: readonly ChatQueueItem[];
  onCancel?: (item: ChatQueueItem) => void;
};

export function Queue({ className, items, onCancel, children, ...props }: QueueProps): ReactNode {
  return (
    <div
      className={cn('my-1 rounded-xl border border-border bg-card p-3 text-[13px]', className)}
      {...props}
    >
      {children ?? (
        <QueueSection defaultOpen>
          <QueueSectionTrigger count={items?.length ?? 0} />
          <QueueSectionContent>
            <QueueList>
              {items?.map((item) => (
                <QueueItem
                  key={item.id}
                  item={item}
                  onCancel={onCancel ? () => onCancel(item) : undefined}
                />
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      )}
    </div>
  );
}

export type QueueSectionProps = ComponentProps<typeof Collapsible>;

export function QueueSection({
  className,
  defaultOpen = true,
  ...props
}: QueueSectionProps): ReactNode {
  return <Collapsible className={className} defaultOpen={defaultOpen} {...props} />;
}

export type QueueSectionTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count?: number;
  label?: string;
};

export function QueueSectionTrigger({
  className,
  count,
  label = 'Queue',
  children,
  ...props
}: QueueSectionTriggerProps): ReactNode {
  return (
    <CollapsibleTrigger
      className={cn('group flex w-full items-center gap-2 text-left font-medium', className)}
      {...props}
    >
      {children ?? (
        <>
          <ListOrderedIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">{label}</span>
          {count !== undefined ? (
            <Badge size="sm" variant="secondary">
              {count}
            </Badge>
          ) : null}
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type QueueSectionContentProps = ComponentProps<typeof CollapsibleContent>;

export function QueueSectionContent({ className, ...props }: QueueSectionContentProps): ReactNode {
  return <CollapsibleContent className={cn('mt-2', className)} {...props} />;
}

export type QueueListProps = ComponentProps<typeof ScrollArea>;

export function QueueList({ className, children, ...props }: QueueListProps): ReactNode {
  return (
    <ScrollArea className={cn('max-h-44 w-full', className)} scrollFade {...props}>
      <ul className="space-y-1 pr-2">{children}</ul>
    </ScrollArea>
  );
}

export type QueueItemProps = ComponentProps<'li'> & {
  item: ChatQueueItem;
  onCancel?: () => void;
};

export function QueueItem({
  className,
  item,
  onCancel,
  children,
  ...props
}: QueueItemProps): ReactNode {
  const canCancel = onCancel && (item.status === 'queued' || item.status === 'running');

  return (
    <li
      className={cn(
        'group flex min-w-0 items-start gap-2 rounded-md px-2 py-1 hover:bg-muted',
        className,
      )}
      {...props}
    >
      <QueueStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-foreground',
            item.status === 'completed' && 'text-muted-foreground',
          )}
        >
          {children ?? item.title}
        </div>
        {item.description ? (
          <div className="line-clamp-2 text-[12px] text-muted-foreground">{item.description}</div>
        ) : null}
      </div>
      <Badge className="shrink-0" size="sm" variant={queueBadgeVariant(item.status)}>
        {item.status}
      </Badge>
      {canCancel ? (
        <Button
          aria-label={`Cancel ${item.title}`}
          className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
          onClick={onCancel}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <XCircleIcon className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
}

function QueueStatusIcon({ status }: { status: ChatQueueItem['status'] }): ReactNode {
  const className = cn('mt-0.5 size-3.5 shrink-0', queueStatusClass(status));

  switch (status) {
    case 'running':
      return <LoaderCircleIcon className={className} />;
    case 'completed':
      return <CheckCircleIcon className={className} />;
    case 'failed':
      return <CircleXIcon className={className} />;
    case 'cancelled':
      return <XCircleIcon className={className} />;
    default:
      return <ClockIcon className={className} />;
  }
}

function queueStatusClass(status: ChatQueueItem['status']): string {
  switch (status) {
    case 'running':
      return 'animate-spin text-warning-foreground';
    case 'completed':
      return 'text-success-foreground';
    case 'failed':
      return 'text-destructive-foreground';
    case 'cancelled':
      return 'text-muted-foreground';
    default:
      return 'text-muted-foreground';
  }
}

function queueBadgeVariant(
  status: ChatQueueItem['status'],
): ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'running':
      return 'warning';
    default:
      return 'secondary';
  }
}
