import { Card } from 'coss-ui/components/card';
import { FileIcon, FileImageIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';

export function AttachmentCard({
  name,
  mimeType,
  size,
  kind,
  previewUrl,
  unavailable = false,
}: {
  name: string;
  mimeType?: string;
  size?: number;
  kind?: string;
  previewUrl?: string;
  unavailable?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.content');
  if (kind === 'image' && previewUrl) {
    return (
      <img
        alt={name}
        className="my-2 max-h-80 max-w-full rounded-xl border border-border"
        src={previewUrl}
        title={name}
      />
    );
  }

  return (
    <Card
      className={cn(
        'my-2 h-14 w-48 flex-row items-center gap-2 px-2 py-0',
        unavailable && 'opacity-70',
      )}
      data-slot="attachment-card"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted p-1.5 text-muted-foreground">
        {kind === 'image' ? (
          <FileImageIcon className="size-full" />
        ) : (
          <FileIcon className="size-full" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate font-medium text-foreground text-xs">{name}</div>
        <div className="truncate text-muted-foreground text-xs">
          {unavailable
            ? t('attachmentUnavailable')
            : (mimeType ?? (size === undefined ? t('attachment') : formatAttachmentSize(size)))}
        </div>
      </div>
    </Card>
  );
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KiB`;
  return `${size} B`;
}
