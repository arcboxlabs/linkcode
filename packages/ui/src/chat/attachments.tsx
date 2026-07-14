import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Spinner } from 'coss-ui/components/spinner';
import {
  AlertCircleIcon,
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  XIcon,
} from 'lucide-react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only attachment model, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when uploads/context files are supported by the data plane.
export interface ChatAttachment {
  id: string;
  name: string;
  kind: ChatAttachmentKind;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  status?: 'pending' | 'ready' | 'failed';
  errorMessage?: string;
}

// TODO(linkcode-schema): Promote the prepared non-image kinds when the data plane supports them.
export type ChatAttachmentKind =
  | 'audio'
  | 'directory'
  | 'document'
  | 'file'
  | 'image'
  | 'pdf'
  | 'unknown'
  | 'url'
  | 'video';

export type AttachmentVariant = 'grid' | 'inline' | 'list';

export type AttachmentsProps = React.ComponentProps<'div'> & {
  attachments?: readonly ChatAttachment[];
  variant?: AttachmentVariant;
  onRemove?: (attachment: ChatAttachment) => void;
};

export function Attachments({
  className,
  attachments,
  variant = 'grid',
  onRemove,
  children,
  ...props
}: AttachmentsProps): React.ReactNode {
  return (
    <div
      className={cn(
        'flex items-start',
        variant === 'list' ? 'flex-col gap-2' : 'flex-wrap gap-2',
        className,
      )}
      data-variant={variant}
      {...props}
    >
      {children ??
        attachments?.map((attachment) => (
          <Attachment
            key={attachment.id}
            attachment={attachment}
            onRemove={onRemove ? () => onRemove(attachment) : undefined}
            variant={variant}
          />
        ))}
    </div>
  );
}

export type AttachmentProps = React.ComponentProps<'div'> & {
  attachment: ChatAttachment;
  variant?: AttachmentVariant;
  onRemove?: () => void;
};

export function Attachment({
  className,
  attachment,
  variant = 'grid',
  onRemove,
  children,
  ...props
}: AttachmentProps): React.ReactNode {
  return (
    <div
      className={cn(
        'group relative min-w-0 overflow-hidden border border-border bg-card',
        variant === 'grid' && 'size-24 rounded-lg',
        variant === 'inline' && 'flex h-8 max-w-64 items-center gap-1.5 rounded-md px-1.5 text-xs',
        variant === 'list' && 'flex w-full items-center gap-3 rounded-lg p-3 text-sm',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <AttachmentPreview attachment={attachment} variant={variant} />
          <AttachmentInfo attachment={attachment} variant={variant} />
          <AttachmentStatus attachment={attachment} variant={variant} />
          <AttachmentRemove attachmentVariant={variant} onRemove={onRemove} />
        </>
      )}
    </div>
  );
}

export type AttachmentPreviewProps = React.ComponentProps<'div'> & {
  attachment: ChatAttachment;
  variant?: AttachmentVariant;
};

export function AttachmentPreview({
  className,
  attachment,
  variant = 'grid',
  ...props
}: AttachmentPreviewProps): React.ReactNode {
  if (attachment.kind === 'image' && attachment.url) {
    return (
      <div
        className={cn('shrink-0 overflow-hidden bg-muted', previewClass(variant), className)}
        {...props}
      >
        <img alt={attachment.name} className="size-full object-cover" src={attachment.url} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center bg-muted text-muted-foreground',
        previewClass(variant),
        className,
      )}
      {...props}
    >
      <AttachmentKindIcon
        className={variant === 'inline' ? 'size-3.5' : 'size-5'}
        kind={attachment.kind}
      />
    </div>
  );
}

export type AttachmentInfoProps = React.ComponentProps<'div'> & {
  attachment: ChatAttachment;
  variant?: AttachmentVariant;
};

export function AttachmentInfo({
  className,
  attachment,
  variant = 'grid',
  ...props
}: AttachmentInfoProps): React.ReactNode {
  if (variant === 'grid') {
    return attachment.status === 'failed' ? (
      <div className="absolute inset-x-1 bottom-1 rounded bg-background/90 px-1 text-xs text-destructive-foreground">
        Failed
      </div>
    ) : null;
  }

  return (
    <div className={cn('min-w-0 flex-1', className)} {...props}>
      <div className="truncate font-medium text-foreground">{attachment.name}</div>
      {variant === 'list' ? (
        <div className="truncate text-xs text-muted-foreground">
          {attachment.errorMessage ?? attachment.mimeType ?? formatBytes(attachment.sizeBytes)}
        </div>
      ) : null}
    </div>
  );
}

export type AttachmentStatusProps = React.ComponentProps<'div'> & {
  attachment: ChatAttachment;
  variant?: AttachmentVariant;
};

export function AttachmentStatus({
  className,
  attachment,
  variant = 'grid',
  ...props
}: AttachmentStatusProps): React.ReactNode {
  const status = attachment.status;
  if (!status || status === 'ready') return null;

  if (variant === 'grid') {
    return (
      <div
        className={cn(
          'absolute top-1 left-1 rounded-full bg-background/90 p-1 text-muted-foreground',
          status === 'failed' && 'text-destructive-foreground',
          className,
        )}
        {...props}
      >
        {status === 'pending' ? (
          <Spinner className="size-3" />
        ) : (
          <AlertCircleIcon className="size-3" />
        )}
      </div>
    );
  }

  return (
    <div className={className} {...props}>
      <Badge size="sm" variant={status === 'failed' ? 'error' : 'warning'}>
        {status}
      </Badge>
    </div>
  );
}

export type AttachmentRemoveProps = React.ComponentProps<typeof Button> & {
  attachmentVariant?: AttachmentVariant;
  onRemove?: () => void;
};

export function AttachmentRemove({
  className,
  attachmentVariant = 'grid',
  onRemove,
  children,
  ...props
}: AttachmentRemoveProps): React.ReactNode {
  if (!onRemove) return null;

  return (
    <Button
      aria-label="Remove attachment"
      className={cn(
        'shrink-0',
        attachmentVariant === 'grid' &&
          'absolute top-1 right-1 size-6 rounded-full bg-background/90',
        attachmentVariant === 'inline' && 'size-5',
        className,
      )}
      onClick={onRemove}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <XIcon className="size-3" />}
    </Button>
  );
}

function AttachmentKindIcon({
  kind,
  className,
}: {
  kind: ChatAttachment['kind'];
  className?: string;
}): React.ReactNode {
  switch (kind) {
    case 'image':
      return <FileImageIcon className={className} />;
    case 'document':
      return <FileTextIcon className={className} />;
    case 'directory':
      return <FolderIcon className={className} />;
    case 'url':
      return <GlobeIcon className={className} />;
    case 'file':
      return <FileArchiveIcon className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}

function previewClass(variant: AttachmentVariant): string {
  switch (variant) {
    case 'grid':
      return 'size-full';
    case 'inline':
      return 'size-5 rounded';
    case 'list':
      return 'size-10 rounded-md';
    default:
      return 'size-5 rounded';
  }
}

function formatBytes(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return '';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
