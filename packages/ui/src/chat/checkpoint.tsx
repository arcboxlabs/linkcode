import { Button } from 'coss-ui/components/button';
import { Separator } from 'coss-ui/components/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { BookmarkIcon, RotateCcwIcon } from 'lucide-react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only checkpoint metadata, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when restore/checkpoint events exist in the data plane.
export interface ChatCheckpoint {
  id: string;
  label: string;
  createdAt?: string;
  description?: string;
  commitSha?: string;
  restorable?: boolean;
}

export type CheckpointProps = React.ComponentProps<'div'> & {
  checkpoint?: ChatCheckpoint;
  onRestore?: (checkpoint: ChatCheckpoint) => void;
};

export function Checkpoint({
  className,
  checkpoint,
  onRestore,
  children,
  ...props
}: CheckpointProps): React.ReactNode {
  return (
    <div
      className={cn('my-2 flex items-center gap-2 text-[13px] text-muted-foreground', className)}
      {...props}
    >
      {children ??
        (checkpoint ? (
          <>
            <CheckpointIcon />
            <div className="min-w-0 flex-1">
              <div className="truncate text-foreground">{checkpoint.label}</div>
              <div className="truncate text-[12px]">
                {checkpoint.description ?? checkpoint.commitSha ?? checkpoint.createdAt}
              </div>
            </div>
            {checkpoint.restorable && onRestore ? (
              <CheckpointTrigger
                tooltip="Restore checkpoint"
                onClick={() => onRestore(checkpoint)}
              />
            ) : null}
            <Separator className="min-w-8 flex-1" />
          </>
        ) : null)}
    </div>
  );
}

export type CheckpointIconProps = React.ComponentProps<typeof BookmarkIcon>;

export function CheckpointIcon({ className, ...props }: CheckpointIconProps): React.ReactNode {
  return <BookmarkIcon className={cn('size-4 shrink-0', className)} {...props} />;
}

export type CheckpointTriggerProps = React.ComponentProps<typeof Button> & {
  tooltip?: string;
};

export function CheckpointTrigger({
  className,
  tooltip,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: CheckpointTriggerProps): React.ReactNode {
  const button = (
    <Button
      className={cn('size-7', className)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children ?? <RotateCcwIcon className="size-3.5" />}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
