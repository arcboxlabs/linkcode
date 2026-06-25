import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import {
  CheckCircleIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  ListTodoIcon,
  MinusCircleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only task item, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when agent task progress is part of the event stream.
export interface ChatTaskItem {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  description?: string;
}

export type TaskProps = ComponentProps<typeof Collapsible> & {
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
}: TaskProps): ReactNode {
  return (
    <Collapsible className={cn('my-1 text-[13px]', className)} defaultOpen={defaultOpen} {...props}>
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

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  count?: number;
};

export function TaskTrigger({
  className,
  title,
  count,
  children,
  ...props
}: TaskTriggerProps): ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex w-fit items-center gap-2 rounded-md px-1.5 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ListTodoIcon className="size-3.5 shrink-0" />
          <span className="font-medium">{title}</span>
          {typeof count === 'number' ? (
            <Badge size="sm" variant="secondary">
              {count}
            </Badge>
          ) : null}
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export function TaskContent({ className, ...props }: TaskContentProps): ReactNode {
  return (
    <CollapsibleContent
      className={cn('mt-1 space-y-1 border-l-2 border-border pl-3', className)}
      {...props}
    />
  );
}

export type TaskItemProps = ComponentProps<'div'> & {
  item: ChatTaskItem;
};

export function TaskItem({ className, item, children, ...props }: TaskItemProps): ReactNode {
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
          <div className="line-clamp-2 text-[12px] text-muted-foreground">{item.description}</div>
        ) : null}
      </div>
    </div>
  );
}

function TaskStatusIcon({ status }: { status: ChatTaskItem['status'] }): ReactNode {
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
