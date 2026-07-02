import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  PencilIcon,
} from 'lucide-react';
import { cn } from '../lib/cn';

export type ToolProps = React.ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps): React.ReactNode {
  return <Collapsible className={cn('group w-full', className)} {...props} />;
}

export type ToolHeaderProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  badge?: string;
  status: ToolCall['status'];
  kind: ToolCall['kind'];
  hasBody?: boolean;
};

export function ToolHeader({
  className,
  title,
  badge,
  status,
  kind,
  hasBody = false,
  ...props
}: ToolHeaderProps): React.ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        'group/header flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent',
        className,
      )}
      disabled={!hasBody}
      {...props}
    >
      <ToolStatusIcon kind={kind} status={status} />
      <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      {hasBody ? (
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/header:rotate-90" />
      ) : null}
    </CollapsibleTrigger>
  );
}

export function ToolStatusIcon({
  status,
  kind,
}: {
  status: ToolCall['status'];
  kind: ToolCall['kind'];
}): React.ReactNode {
  switch (status) {
    case 'pending':
      return <CircleIcon className="size-4 text-muted-foreground/60" />;
    case 'in_progress':
      return <Spinner className="size-4 text-foreground" />;
    case 'completed':
      return kind === 'edit' || kind === 'delete' ? (
        <PencilIcon className="size-4 text-foreground" />
      ) : (
        <CircleCheckIcon className="size-4 text-success-foreground" />
      );
    case 'failed':
      return <CircleXIcon className="size-4 text-destructive-foreground" />;
    default:
      return <CircleIcon className="size-4 text-muted-foreground/60" />;
  }
}

export type ToolContentProps = React.ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps): React.ReactNode {
  return (
    <CollapsibleContent
      className={cn('mt-1 ml-1 space-y-2 border-l-2 border-border pl-3', className)}
      {...props}
    />
  );
}

export type ToolSectionProps = React.ComponentProps<'div'> & {
  label?: string;
};

export function ToolSection({
  className,
  label,
  children,
  ...props
}: ToolSectionProps): React.ReactNode {
  return (
    <div className={className} {...props}>
      {label ? (
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      ) : null}
      {children}
    </div>
  );
}

export function ToolJson({ value }: { value: unknown }): React.ReactNode {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
