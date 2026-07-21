import type { ToolCall } from '@linkcode/schema';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import { BanIcon, CircleXIcon, ShieldIcon } from 'lucide-react';
import { useRef } from 'react';
import { cn } from '../lib/cn';
import { DiffCounter } from './diff-block';
import type { DiffStats } from './diff-utils';
import type { ChatDisclosureContentProps } from './disclosure-content';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_SUMMARY_CLASS_NAME,
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import { TOOL_KIND_ICONS } from './tool-utils';
import { FilePathTooltip } from './with-tooltip';

export type ToolProps = React.ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps): React.ReactNode {
  return <Collapsible className={cn('group w-full', className)} {...props} />;
}

export type ToolHeaderProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  /** Curated context such as a path, query, URL, or command. */
  summary?: string;
  /** Unshortened context for a compact summary. */
  tooltip?: string;
  diffStats?: DiffStats;
  /** Short localized state text for approval, failure, or rejection. */
  statusLabel?: string;
  status: ToolCall['status'];
  kind: ToolCall['kind'];
  /** The call's gating permission is still awaiting an answer (shows the shield glyph). */
  awaitingApproval?: boolean;
  /** The user declined this call's gating permission. */
  declined?: boolean;
  /** Custom glyph for plugin / MCP / custom tool calls; replaces the kind icon. */
  icon?: React.ReactNode;
  hasBody?: boolean;
};

export function ToolHeader({
  className,
  title,
  summary,
  tooltip,
  diffStats,
  statusLabel,
  status,
  kind,
  awaitingApproval = false,
  declined = false,
  icon,
  hasBody = false,
  ...props
}: ToolHeaderProps): React.ReactNode {
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);
  const titleAnchorRef = tooltip && !summary ? tooltipAnchorRef : undefined;
  const content = (
    <>
      <ChatDisclosureIconSlot>
        <ToolIcon
          awaitingApproval={awaitingApproval}
          declined={declined}
          icon={icon}
          kind={kind}
          status={status}
        />
      </ChatDisclosureIconSlot>
      <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
        <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME} ref={titleAnchorRef}>
          {title}
        </span>
        {summary ? (
          <span className={CHAT_DISCLOSURE_SUMMARY_CLASS_NAME} ref={tooltipAnchorRef}>
            · {summary}
          </span>
        ) : null}
      </span>
      {diffStats ? <DiffCounter stats={diffStats} /> : null}
      {statusLabel ? (
        <span
          className={cn(
            'shrink-0 text-xs',
            awaitingApproval ? 'text-warning-foreground' : 'text-destructive-foreground',
          )}
        >
          {statusLabel}
        </span>
      ) : null}
      {hasBody ? <ChatDisclosureChevron /> : null}
    </>
  );
  const headerClassName = cn(
    CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
    'w-full',
    !hasBody && 'cursor-default',
    className,
  );

  return (
    <FilePathTooltip anchor={tooltipAnchorRef} tooltip={tooltip}>
      {hasBody ? (
        <CollapsibleTrigger className={headerClassName} {...props}>
          {content}
        </CollapsibleTrigger>
      ) : (
        <div
          className={cn(
            headerClassName,
            tooltip &&
              'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          )}
          tabIndex={tooltip ? 0 : undefined}
        >
          {content}
        </div>
      )}
    </FilePathTooltip>
  );
}

/** A call's glyph names important state first, then falls back to its action kind. */
export function ToolIcon({
  status,
  kind,
  awaitingApproval = false,
  declined = false,
  icon,
}: {
  status: ToolCall['status'];
  kind: ToolCall['kind'];
  awaitingApproval?: boolean;
  declined?: boolean;
  icon?: React.ReactNode;
}): React.ReactNode {
  if (awaitingApproval) {
    return <ShieldIcon className="size-3.5 shrink-0 text-warning-foreground" />;
  }
  if (declined) return <BanIcon className="size-3.5 shrink-0 text-destructive-foreground" />;
  if (status === 'failed') {
    return <CircleXIcon className="size-3.5 shrink-0 text-destructive-foreground" />;
  }
  if (status === 'pending' || status === 'in_progress') {
    return <Spinner className="size-3.5 shrink-0 text-foreground" />;
  }
  if (icon) return icon;
  const KindIcon = TOOL_KIND_ICONS[kind];
  return <KindIcon className="size-3.5 shrink-0 text-muted-foreground" />;
}

export type ToolContentProps = ChatDisclosureContentProps;

export function ToolContent({
  bodyClassName,
  className,
  constrainHeight = true,
  ...props
}: ToolContentProps): React.ReactNode {
  return (
    <ChatDisclosureContent
      bodyClassName={cn('space-y-2', bodyClassName)}
      className={cn('mt-1 border-0', className)}
      constrainHeight={constrainHeight}
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
