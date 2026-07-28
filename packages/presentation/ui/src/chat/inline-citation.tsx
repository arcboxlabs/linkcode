import { Badge } from 'coss-ui/components/badge';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import { ExternalLinkIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { UrlLinkIcon } from './link-icon';

// TODO(linkcode-schema): Provisional UI-only citation reference, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema citation metadata when message content supports citations.
export interface ChatCitation {
  id: string;
  sourceId: string;
  label?: string;
  title?: string;
  url?: string;
}

export type InlineCitationProps = React.ComponentProps<'span'>;

export function InlineCitation({ className, ...props }: InlineCitationProps): React.ReactNode {
  return <span className={cn('inline', className)} {...props} />;
}

export type InlineCitationTextProps = React.ComponentProps<'span'>;

export function InlineCitationText({
  className,
  ...props
}: InlineCitationTextProps): React.ReactNode {
  return <span className={cn('rounded-sm hover:bg-muted', className)} {...props} />;
}

export type InlineCitationCardProps = React.ComponentProps<typeof Popover> & {
  citation: ChatCitation;
};

export function InlineCitationCard({
  citation,
  children,
  ...props
}: InlineCitationCardProps): React.ReactNode {
  return (
    <Popover {...props}>
      {children ?? (
        <>
          <InlineCitationTrigger citation={citation} />
          <InlineCitationContent citation={citation} />
        </>
      )}
    </Popover>
  );
}

export type InlineCitationTriggerProps = React.ComponentProps<typeof Badge> & {
  citation: ChatCitation;
};

export function InlineCitationTrigger({
  className,
  citation,
  children,
  ...props
}: InlineCitationTriggerProps): React.ReactNode {
  return (
    <PopoverTrigger
      render={
        <Badge
          className={cn('mx-0.5 align-baseline', className)}
          size="sm"
          variant="secondary"
          {...props}
        >
          {children ?? (
            <>
              <UrlLinkIcon url={citation.url} className="size-3" />
              {citation.label ?? citation.sourceId}
            </>
          )}
        </Badge>
      }
    />
  );
}

export type InlineCitationContentProps = React.ComponentProps<typeof PopoverPopup> & {
  citation: ChatCitation;
};

export function InlineCitationContent({
  className,
  citation,
  children,
  ...props
}: InlineCitationContentProps): React.ReactNode {
  return (
    <PopoverPopup align="start" className={cn('w-72 p-0', className)} side="top" {...props}>
      <div className="space-y-2 p-3 text-sm">
        {children ?? <InlineCitationSource citation={citation} />}
      </div>
    </PopoverPopup>
  );
}

export type InlineCitationSourceProps = React.ComponentProps<'div'> & {
  citation: ChatCitation;
};

export function InlineCitationSource({
  className,
  citation,
  children,
  ...props
}: InlineCitationSourceProps): React.ReactNode {
  return (
    <div className={cn('min-w-0 space-y-1', className)} {...props}>
      {children ?? (
        <>
          <div className="flex min-w-0 items-center gap-1 font-medium text-foreground">
            <UrlLinkIcon url={citation.url} className="shrink-0" />
            <span className="truncate">
              {citation.title ?? citation.label ?? citation.sourceId}
            </span>
          </div>
          {citation.url ? (
            <a
              className="flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground"
              href={citation.url}
              rel="noreferrer"
              target="_blank"
            >
              <span className="truncate">{citation.url}</span>
              <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
          ) : null}
        </>
      )}
    </div>
  );
}
