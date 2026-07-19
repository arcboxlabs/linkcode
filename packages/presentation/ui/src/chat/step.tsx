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

export type StepProps = React.ComponentProps<typeof Collapsible>;

export function Step({ className, defaultOpen = true, ...props }: StepProps): React.ReactNode {
  return (
    <Collapsible
      className={cn('my-1 rounded-xl border border-border bg-card p-3', className)}
      defaultOpen={defaultOpen}
      {...props}
    />
  );
}

export type StepHeaderProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
};

export function StepHeader({
  className,
  title,
  children,
  ...props
}: StepHeaderProps): React.ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex w-full items-center gap-2 text-left text-sm font-medium',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ListTodoIcon className="3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1">{title}</span>
          <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type StepContentProps = React.ComponentProps<typeof CollapsibleContent>;

export function StepContent({ className, ...props }: StepContentProps): React.ReactNode {
  return <CollapsibleContent className={cn('mt-2', className)} {...props} />;
}

export type StepItemStatus = 'pending' | 'in_progress' | 'completed';

export type StepItemProps = React.ComponentProps<'div'> & {
  status: StepItemStatus;
};

export function StepItem({
  className,
  status,
  children,
  ...props
}: StepItemProps): React.ReactNode {
  return (
    <div className={cn('flex items-center gap-2 py-0.5 text-sm', className)} {...props}>
      <StepItemIcon status={status} />
      <span
        className={cn('flex-1', status === 'completed' && 'text-muted-foreground line-through')}
      >
        {children}
      </span>
    </div>
  );
}

function StepItemIcon({ status }: { status: StepItemStatus }): React.ReactNode {
  switch (status) {
    case 'pending':
      return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground/60" />;
    case 'in_progress':
      return (
        <CircleDashedIcon className="size-3.5 shrink-0 text-warning-foreground animate-spin" />
      );
    case 'completed':
      return <CircleCheckIcon className="size-3.5 shrink-0 text-success-foreground" />;
    default:
      return <CircleIcon className="size-3.5 shrink-0 text-muted-foreground/60" />;
  }
}
