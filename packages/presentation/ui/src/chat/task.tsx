import { Badge } from 'coss-ui/components/badge';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  ListTodoIcon,
  MinusCircleIcon,
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

// TODO(linkcode-schema): Provisional UI-only task item, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when agent task progress is part of the event stream.
export interface ChatTaskItem {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  description?: string;
}

export type TaskProps = React.ComponentProps<typeof Collapsible> & {
  items?: readonly ChatTaskItem[];
  title?: string;
};

export function Task({
  className,
  defaultOpen = true,
  items,
  title = 'Tasks',
  children,
  ...props
}: TaskProps): React.ReactNode {
  return (
    <Collapsible className={cn('my-1 text-sm', className)} defaultOpen={defaultOpen} {...props}>
      {children ?? (
        <>
          <TaskTrigger count={items?.length ?? 0} title={title} />
          <TaskContent>
            {items?.map((item) => (
              <TaskItem key={item.id} item={item} />
            ))}
          </TaskContent>
        </>
      )}
    </Collapsible>
  );
}

export type TaskTriggerProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  count?: number;
};

export function TaskTrigger({
  className,
  title,
  count,
  children,
  ...props
}: TaskTriggerProps): React.ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
        'w-fit max-w-full rounded-md px-1.5 hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ChatDisclosureIconSlot>
            <ListTodoIcon />
          </ChatDisclosureIconSlot>
          <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
            <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>{title}</span>
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

export type TaskContentProps = ChatDisclosureContentProps;

export function TaskContent({
  bodyClassName,
  className,
  ...props
}: TaskContentProps): React.ReactNode {
  return (
    <ChatDisclosureContent
      bodyClassName={cn('space-y-1', bodyClassName)}
      className={cn('mt-1 border-l-2 border-border pl-3', className)}
      {...props}
    />
  );
}

export type TaskItemProps = React.ComponentProps<'div'> & {
  item: ChatTaskItem;
};

export function TaskItem({ className, item, children, ...props }: TaskItemProps): React.ReactNode {
  return (
    <div className={cn('flex min-w-0 items-start gap-2 py-0.5', className)} {...props}>
      <TaskStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-foreground',
            item.status === 'completed' && 'text-muted-foreground line-through',
            item.status === 'skipped' && 'text-muted-foreground',
          )}
        >
          {children ?? item.title}
        </div>
        {item.description ? (
          <div className="line-clamp-2 text-xs text-muted-foreground">{item.description}</div>
        ) : null}
      </div>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: ChatTaskItem['status'] }): React.ReactNode {
  const className = cn('mt-0.5 size-3.5 shrink-0', taskStatusClass(status));

  switch (status) {
    case 'running':
      return <CircleDashedIcon className={className} />;
    case 'completed':
      return <CheckCircleIcon className={className} />;
    case 'failed':
      return <CircleXIcon className={className} />;
    case 'skipped':
      return <MinusCircleIcon className={className} />;
    default:
      return <CircleIcon className={className} />;
  }
}

function taskStatusClass(status: ChatTaskItem['status']): string {
  switch (status) {
    case 'running':
      return 'text-warning-foreground';
    case 'completed':
      return 'text-success-foreground';
    case 'failed':
      return 'text-destructive-foreground';
    default:
      return 'text-muted-foreground';
  }
}
