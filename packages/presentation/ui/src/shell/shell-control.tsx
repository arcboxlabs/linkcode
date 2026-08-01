import type { SessionId } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Kbd } from 'coss-ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { useInputModality } from '../input-modality';
import { cn } from '../lib/cn';

export type ShellIconButtonProps = React.ComponentProps<typeof Button> & {
  label: string;
  /** Pre-formatted shortcut hint (e.g. "⌘J") — upgrades the native title to a rich tooltip. */
  shortcut?: string;
};

export function ShellIconButton({
  label,
  shortcut,
  className,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: ShellIconButtonProps): React.ReactNode {
  const button = (
    <Button
      aria-label={label}
      className={cn(
        'pointer-events-auto text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]',
        className,
      )}
      size={size}
      title={shortcut === undefined ? label : undefined}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );

  if (shortcut === undefined) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">
        <span className="flex items-center gap-1.5">
          {label}
          <Kbd>{shortcut}</Kbd>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export type PanelControlButtonProps = ShellIconButtonProps & {
  active?: boolean;
};

export function PanelControlButton({
  active,
  className,
  children,
  ...props
}: PanelControlButtonProps): React.ReactNode {
  return (
    <ShellIconButton
      aria-pressed={active || undefined}
      className={cn(active && 'text-info-foreground', className)}
      {...props}
    >
      {children}
    </ShellIconButton>
  );
}

export type ThreadTitleProps = React.ComponentProps<'div'> & {
  /** The open thread; keys the element internally so a switch remounts it and replays the
   * entrance. A rename inside the same thread keeps the key and stays put. */
  sessionId?: SessionId | null;
};

/** The header's thread title. The entrance plays only for pointer-driven switches — the history
 * chords and the palette repeat far too often to animate. */
export function ThreadTitle({ sessionId, className, ...props }: ThreadTitleProps): React.ReactNode {
  const pointerDriven = useInputModality() === 'pointer';

  return (
    <div
      key={sessionId ?? 'none'}
      className={cn('truncate', pointerDriven && 'thread-title-enter', className)}
      {...props}
    />
  );
}

export function TitleStrip({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 bg-background/95 px-2 text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
