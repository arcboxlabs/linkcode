import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { ScrollArea } from 'coss-ui/components/scroll-area';
import { Spinner } from 'coss-ui/components/spinner';
import {
  CheckCircleIcon,
  CircleXIcon,
  ClockIcon,
  ListOrderedIcon,
  XCircleIcon,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { ChatDisclosureContentProps } from './disclosure-content';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';

// TODO(linkcode-schema): Provisional UI-only queue item, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when queued agent operations are emitted by client-core.
export interface ChatQueueItem {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  description?: string;
}

export type QueueProps = React.ComponentProps<'div'> & {
  items?: readonly ChatQueueItem[];
  onCancel?: (item: ChatQueueItem) => void;
};

export function Queue({
  className,
  items,
  onCancel,
  children,
  ...props
}: QueueProps): React.ReactNode {
  return (
    <div
      className={cn('my-1 rounded-xl border border-border bg-card p-3 text-sm', className)}
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

export type QueueSectionProps = React.ComponentProps<typeof Collapsible>;

export function QueueSection({
  className,
  defaultOpen = true,
  ...props
}: QueueSectionProps): React.ReactNode {
  return <Collapsible className={className} defaultOpen={defaultOpen} {...props} />;
}

export type QueueSectionTriggerProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  count?: number;
  label?: string;
};

export function QueueSectionTrigger({
  className,
  count,
  label = 'Queue',
  children,
  ...props
}: QueueSectionTriggerProps): React.ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'w-full', className)}
      {...props}
    >
      {children ?? (
        <>
          <ChatDisclosureIconSlot>
            <ListOrderedIcon />
          </ChatDisclosureIconSlot>
          <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
            <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>{label}</span>
          </span>
          {typeof count === 'number' ? (
            <Badge className="shrink-0" size="sm" variant="secondary">
              {count}
            </Badge>
          ) : null}
          <ChatDisclosureChevron />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type QueueSectionContentProps = ChatDisclosureContentProps;

export function QueueSectionContent({
  className,
  ...props
}: QueueSectionContentProps): React.ReactNode {
  return <ChatDisclosureContent className={cn('mt-2', className)} {...props} />;
}

export type QueueListProps = React.ComponentProps<typeof ScrollArea>;

export function QueueList({ className, children, ...props }: QueueListProps): React.ReactNode {
  return (
    <ScrollArea className={cn('max-h-44 w-full', className)} scrollFade {...props}>
      <ul className="space-y-1 pr-2">{children}</ul>
    </ScrollArea>
  );
}

export type QueueItemProps = React.ComponentProps<'li'> & {
  item: ChatQueueItem;
  onCancel?: () => void;
};

export function QueueItem({
  className,
  item,
  onCancel,
  children,
  ...props
}: QueueItemProps): React.ReactNode {
  const canCancel = item.status === 'queued' || item.status === 'running';

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
          <div className="line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
        ) : null}
      </div>
      <Badge className="shrink-0" size="sm" variant={queueBadgeVariant(item.status)}>
        {item.status}
      </Badge>
      {canCancel && onCancel ? (
        <Button
          aria-label={`Cancel ${item.title}`}
          className="shrink-0 opacity-0 group-hover:opacity-100"
          onClick={onCancel}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <XCircleIcon />
        </Button>
      ) : null}
    </li>
  );
}

function QueueStatusIcon({ status }: { status: ChatQueueItem['status'] }): React.ReactNode {
  const className = cn('mt-0.5 size-3.5 shrink-0', queueStatusClass(status));

  switch (status) {
    case 'running':
      return <Spinner className={className} />;
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
      return 'text-warning-foreground';
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
): React.ComponentProps<typeof Badge>['variant'] {
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
