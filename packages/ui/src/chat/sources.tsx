import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { BookOpenIcon, ChevronRightIcon, ExternalLinkIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only source metadata, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when assistant messages can emit source/citation metadata.
export interface ChatSource {
  id: string;
  title: string;
  url?: string;
  label?: string;
  description?: string;
  icon?: ReactNode;
}

export type SourcesProps = ComponentProps<typeof Collapsible> & {
  sources?: readonly ChatSource[];
  title?: string;
};

export function Sources({
  className,
  defaultOpen = false,
  sources,
  title,
  children,
  ...props
}: SourcesProps): ReactNode {
  return (
    <Collapsible
      className={cn('my-1 w-full text-[13px] text-muted-foreground', className)}
      defaultOpen={defaultOpen}
      {...props}
    >
      {children ?? (
        <>
          <SourcesTrigger count={sources?.length ?? 0} title={title} />
          <SourcesContent>
            {sources?.map((source) => (
              <Source key={source.id} source={source} />
            ))}
          </SourcesContent>
        </>
      )}
    </Collapsible>
  );
}

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
  title?: string;
};

export function SourcesTrigger({
  className,
  count,
  title,
  children,
  ...props
}: SourcesTriggerProps): ReactNode {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex w-fit items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <BookOpenIcon className="size-3.5 shrink-0" />
          <span>{title ?? 'Sources'}</span>
          <Badge size="sm" variant="secondary">
            {count}
          </Badge>
          <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export function SourcesContent({ className, ...props }: SourcesContentProps): ReactNode {
  return (
    <CollapsibleContent
      className={cn('mt-1 flex max-w-full flex-col gap-1 border-l-2 border-border pl-3', className)}
      {...props}
    />
  );
}

export type SourceProps = ComponentProps<'div'> & {
  source: ChatSource;
};

export function Source({ className, source, ...props }: SourceProps): ReactNode {
  const content = (
    <>
      <span className="mt-0.5 shrink-0">
        {source.icon ?? <BookOpenIcon className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="truncate font-medium text-foreground">{source.title}</span>
          {source.url ? <ExternalLinkIcon className="size-3 shrink-0" /> : null}
        </span>
        {source.description ? (
          <span className="line-clamp-2 text-muted-foreground">{source.description}</span>
        ) : null}
      </span>
      {source.label ? (
        <Badge className="shrink-0" size="sm" variant="outline">
          {source.label}
        </Badge>
      ) : null}
    </>
  );

  if (source.url) {
    return (
      <div className={className} {...props}>
        <a
          className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
          href={source.url}
          rel="noreferrer"
          target="_blank"
        >
          {content}
        </a>
      </div>
    );
  }

  return (
    <div
      className={cn('flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1', className)}
      {...props}
    >
      {content}
    </div>
  );
}
