import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import { ChevronRightIcon, ShieldIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { DiffCounter } from './diff-block';
import type { DiffStats } from './diff-utils';
import { TOOL_KIND_ICONS } from './tool-utils';

export const TOOL_DETAIL_SCROLL_CLASS_NAME = 'max-h-96 overflow-y-auto overscroll-contain';

export type ToolProps = React.ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps): React.ReactNode {
  return <Collapsible className={cn('group w-full', className)} {...props} />;
}

export type ToolHeaderProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  /** Curated context such as a path, query, URL, or command. */
  summary?: string;
  diffStats?: DiffStats;
  badge?: string;
  /** Localized marker for a call whose gating permission the user declined. */
  declinedBadge?: string;
  status: ToolCall['status'];
  kind: ToolCall['kind'];
  /** The call's gating permission is still awaiting an answer (shows the shield glyph). */
  awaitingApproval?: boolean;
  /** Custom glyph for plugin / MCP / custom tool calls; replaces the kind icon. */
  icon?: React.ReactNode;
  hasBody?: boolean;
};

export function ToolHeader({
  className,
  title,
  summary,
  diffStats,
  badge,
  declinedBadge,
  status,
  kind,
  awaitingApproval = false,
  icon,
  hasBody = false,
  ...props
}: ToolHeaderProps): React.ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        'group/header flex w-full items-center gap-2 py-1 text-left text-sm disabled:cursor-default',
        className,
      )}
      disabled={!hasBody}
      {...props}
    >
      <ToolIcon awaitingApproval={awaitingApproval} icon={icon} kind={kind} status={status} />
      <span className={cn('min-w-0 truncate text-foreground', summary ? 'shrink' : 'flex-1')}>
        {title}
      </span>
      {diffStats ? <DiffCounter stats={diffStats} /> : null}
      {summary ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">· {summary}</span>
      ) : null}
      {declinedBadge ? <Badge variant="error">{declinedBadge}</Badge> : null}
      {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      {hasBody ? (
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/header:rotate-90" />
      ) : null}
    </CollapsibleTrigger>
  );
}

/**
 * A call's glyph names what it does, not how it went: the kind icon (or a custom `icon` for
 * plugin / MCP / custom tools), with the spinner while running and the shield while its
 * permission ask is open. Failure reads via color, never a cross.
 */
export function ToolIcon({
  status,
  kind,
  awaitingApproval = false,
  icon,
}: {
  status: ToolCall['status'];
  kind: ToolCall['kind'];
  awaitingApproval?: boolean;
  icon?: React.ReactNode;
}): React.ReactNode {
  if (awaitingApproval) return <ShieldIcon className="size-3.5 text-warning-foreground" />;
  if (status === 'in_progress') return <Spinner className="size-3.5 text-foreground" />;
  if (icon) return icon;
  const KindIcon = TOOL_KIND_ICONS[kind];
  return (
    <KindIcon
      className={cn(
        'size-3.5',
        status === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
      )}
    />
  );
}

export type ToolContentProps = React.ComponentProps<typeof CollapsibleContent> & {
  constrainHeight?: boolean;
};

export function ToolContent({
  className,
  constrainHeight = true,
  ...props
}: ToolContentProps): React.ReactNode {
  return (
    <CollapsibleContent
      className={cn(
        'mt-1 space-y-2 border-l-2 border-border pl-3',
        constrainHeight && TOOL_DETAIL_SCROLL_CLASS_NAME,
        className,
      )}
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
