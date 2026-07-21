import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Spinner } from 'coss-ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { AlertCircleIcon, FileImageIcon, XIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import type { FileIconComponent } from '../lib/file-icon';
import { fileIconFor } from '../lib/file-icon';

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

export interface AttachmentLabels {
  failed: string;
  pending: string;
  remove: string;
}

export type AttachmentsProps = React.ComponentProps<'div'> & {
  attachments?: readonly ChatAttachment[];
  labels: AttachmentLabels;
  onRemove?: (attachment: ChatAttachment) => void;
};

export function Attachments({
  className,
  attachments,
  labels,
  onRemove,
  children,
  ...props
}: AttachmentsProps): React.ReactNode {
  const compact = attachments?.some((attachment) => attachment.kind !== 'image') ?? false;

  return (
    <div
      className={cn('flex min-w-0 flex-nowrap items-stretch gap-2 overflow-x-auto', className)}
      {...props}
    >
      {children ??
        attachments?.map((attachment) => (
          <Attachment
            key={attachment.id}
            attachment={attachment}
            compact={compact}
            labels={labels}
            onRemove={onRemove ? () => onRemove(attachment) : undefined}
          />
        ))}
    </div>
  );
}

type AttachmentProps = React.ComponentProps<typeof Card> & {
  attachment: ChatAttachment;
  compact: boolean;
  labels: AttachmentLabels;
  onRemove?: () => void;
};

function Attachment({
  className,
  attachment,
  compact,
  labels,
  onRemove,
  children,
  ...props
}: AttachmentProps): React.ReactNode {
  const isImage = attachment.kind === 'image';

  return (
    <Card
      className={cn(
        'group min-w-0 shrink-0 overflow-hidden',
        isImage
          ? compact
            ? 'size-14'
            : 'size-24'
          : 'h-14 w-48 flex-row items-center gap-2 px-2 py-0',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {isImage ? (
            <Tooltip>
              <TooltipTrigger delay={300} render={<AttachmentImage attachment={attachment} />} />
              <TooltipContent>{attachment.name}</TooltipContent>
            </Tooltip>
          ) : (
            <AttachmentFile attachment={attachment} labels={labels} />
          )}
          {isImage ? <AttachmentStatus attachment={attachment} labels={labels} overlay /> : null}
          <AttachmentRemove removeLabel={labels.remove} onRemove={onRemove} />
        </>
      )}
    </Card>
  );
}

type AttachmentImageProps = React.ComponentProps<'div'> & {
  attachment: ChatAttachment;
};

function AttachmentImage({
  className,
  attachment,
  ...props
}: AttachmentImageProps): React.ReactNode {
  if (attachment.url) {
    return (
      <div className={cn('size-full overflow-hidden', className)} {...props}>
        <img alt={attachment.name} className="size-full object-cover" src={attachment.url} />
      </div>
    );
  }

  return (
    <div
      className={cn('flex size-full items-center justify-center text-muted-foreground', className)}
      {...props}
    >
      <FileImageIcon className="size-5" />
    </div>
  );
}

type AttachmentFileProps = React.ComponentProps<'div'> & {
  attachment: ChatAttachment;
  labels: AttachmentLabels;
};

function AttachmentFile({
  className,
  attachment,
  labels,
  ...props
}: AttachmentFileProps): React.ReactNode {
  return (
    <>
      <div className="flex size-8 p-1.5 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <AttachmentKindIcon icon={fileIconFor(attachment)} />
      </div>
      <div className={cn('min-w-0 flex flex-col flex-1 gap-0.5', className)} {...props}>
        <div className="truncate font-medium text-xs text-foreground">{attachment.name}</div>
        <div className="flex min-h-4 items-center gap-1">
          <span className="truncate text-xs text-muted-foreground">
            {attachmentExtensionLabel(attachment)}
          </span>
          <AttachmentStatus attachment={attachment} labels={labels} />
        </div>
      </div>
    </>
  );
}

type AttachmentStatusProps = Omit<React.ComponentProps<typeof Badge>, 'variant'> & {
  attachment: ChatAttachment;
  labels: AttachmentLabels;
  overlay?: boolean;
};

function AttachmentStatus({
  className,
  attachment,
  labels,
  overlay = false,
  ...props
}: AttachmentStatusProps): React.ReactNode {
  const status = attachment.status;
  if (!status || status === 'ready') return null;

  return (
    <Badge
      {...props}
      className={cn(overlay && 'absolute bottom-2 left-2', className)}
      size="sm"
      variant={status === 'failed' ? 'error' : 'warning'}
    >
      {status === 'pending' ? <Spinner /> : <AlertCircleIcon />}
      {labels[status]}
    </Badge>
  );
}

type AttachmentRemoveProps = React.ComponentProps<typeof Button> & {
  removeLabel: string;
  onRemove?: () => void;
};

function AttachmentRemove({
  className,
  removeLabel,
  onRemove,
  children,
  ...props
}: AttachmentRemoveProps): React.ReactNode {
  if (!onRemove) return null;

  return (
    <Button
      aria-label={removeLabel}
      className={cn(
        'absolute top-1 right-1 bg-background opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100 hover:bg-background',
        className,
      )}
      onClick={onRemove}
      size="icon-xs"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <XIcon />}
    </Button>
  );
}

function AttachmentKindIcon({ icon: Icon }: { icon: FileIconComponent }): React.ReactNode {
  return <Icon className="size-full" />;
}

function attachmentExtensionLabel(attachment: ChatAttachment): string {
  const dot = attachment.name.lastIndexOf('.');
  if (dot > 0 && dot < attachment.name.length - 1) {
    return attachment.name.slice(dot + 1).toUpperCase();
  }
  const mimeSubtype = attachment.mimeType?.split('/', 2)[1];
  return (mimeSubtype ?? attachment.kind).toUpperCase();
}
