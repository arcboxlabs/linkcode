import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  ListTodoIcon,
} from 'lucide-react';
import { cn } from '../lib/cn';

export type PlanProps = React.ComponentProps<typeof Collapsible>;

export function Plan({ className, defaultOpen = true, ...props }: PlanProps): React.ReactNode {
  return (
    <Collapsible
      className={cn('my-1 rounded-xl border border-border bg-card p-3', className)}
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

export type PlanHeaderProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export function PlanHeader({
  className,
  title,
  children,
  ...props
}: PlanHeaderProps): React.ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex w-full items-center gap-2 text-left text-[13px] font-medium',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ListTodoIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">{title}</span>
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type PlanContentProps = React.ComponentProps<typeof CollapsibleContent>;

export function PlanContent({ className, ...props }: PlanContentProps): React.ReactNode {
  return <CollapsibleContent className={cn('mt-2', className)} {...props} />;
}

export type PlanItemStatus = 'pending' | 'in_progress' | 'completed';

export type PlanItemProps = React.ComponentProps<'div'> & {
  status: PlanItemStatus;
};

export function PlanItem({
  className,
  status,
  children,
  ...props
}: PlanItemProps): React.ReactNode {
  return (
    <div className={cn('flex items-start gap-2 py-0.5 text-[13px]', className)} {...props}>
      <PlanItemIcon status={status} />
      <span
        className={cn('flex-1', status === 'completed' && 'text-muted-foreground line-through')}
      >
        {children}
      </span>
    </div>
  );
}

function PlanItemIcon({ status }: { status: PlanItemStatus }): React.ReactNode {
  switch (status) {
    case 'pending':
      return <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />;
    case 'in_progress':
      return <CircleDashedIcon className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />;
    case 'completed':
      return <CircleCheckIcon className="mt-0.5 size-3.5 shrink-0 text-success-foreground" />;
    default:
      return <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />;
  }
}
