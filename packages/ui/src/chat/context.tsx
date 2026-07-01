import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  BoxSelectIcon,
  BracesIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  NetworkIcon,
  PanelsTopLeftIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only context item, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when active context/files are emitted by the runtime data plane.
export interface ChatContextItem {
  id: string;
  label: string;
  kind: 'file' | 'directory' | 'symbol' | 'selection' | 'url' | 'workspace' | 'unknown';
  description?: string;
  path?: string;
  removable?: boolean;
}

export type ChatContextProps = React.ComponentProps<'div'> & {
  items?: readonly ChatContextItem[];
  onRemove?: (item: ChatContextItem) => void;
};

export function ChatContext({
  className,
  items,
  onRemove,
  children,
  ...props
}: ChatContextProps): React.ReactNode {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} {...props}>
      {children ??
        items?.map((item) => (
          <ChatContextChip
            key={item.id}
            item={item}
            onRemove={item.removable ? () => onRemove?.(item) : undefined}
          />
        ))}
    </div>
  );
}

export type ChatContextChipProps = React.ComponentProps<'span'> & {
  item: ChatContextItem;
  onRemove?: () => void;
};

export function ChatContextChip({
  className,
  item,
  onRemove,
  children,
  ...props
}: ChatContextChipProps): React.ReactNode {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[12px]',
        className,
      )}
      title={item.path ?? item.description}
      {...props}
    >
      {children ?? (
        <>
          <ContextKindIcon className="size-3.5 shrink-0 text-muted-foreground" kind={item.kind} />
          <span className="min-w-0 truncate text-foreground">{item.label}</span>
          <Badge className="shrink-0" size="sm" variant="secondary">
            {item.kind}
          </Badge>
          {onRemove ? (
            <Button
              aria-label={`Remove ${item.label}`}
              className="-mr-1 size-5"
              onClick={onRemove}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <XIcon className="size-3" />
            </Button>
          ) : null}
        </>
      )}
    </span>
  );
}

function ContextKindIcon({
  kind,
  className,
}: {
  kind: ChatContextItem['kind'];
  className?: string;
}): React.ReactNode {
  switch (kind) {
    case 'directory':
      return <FolderIcon className={className} />;
    case 'symbol':
      return <BracesIcon className={className} />;
    case 'selection':
      return <BoxSelectIcon className={className} />;
    case 'url':
      return <GlobeIcon className={className} />;
    case 'workspace':
      return <PanelsTopLeftIcon className={className} />;
    case 'file':
      return <FileIcon className={className} />;
    default:
      return <NetworkIcon className={className} />;
  }
}
