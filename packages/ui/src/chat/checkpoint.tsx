import { Button } from 'coss-ui/components/button';
import { Separator } from 'coss-ui/components/separator';
import { BookmarkIcon, RotateCcwIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { withTooltip } from './with-tooltip';

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
      className={cn('my-2 flex items-center gap-2 text-sm text-muted-foreground', className)}
      {...props}
    >
      {children ??
        (checkpoint ? (
          <>
            <CheckpointIcon />
            <div className="min-w-0">
              <div className="truncate text-foreground">{checkpoint.label}</div>
              <div className="truncate text-xs">
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
  tooltip,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: CheckpointTriggerProps): React.ReactNode {
  return withTooltip(
    <Button size={size} type="button" variant={variant} {...props}>
      {children ?? <RotateCcwIcon />}
    </Button>,
    tooltip,
  );
}
