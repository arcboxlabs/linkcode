import { Button } from 'coss-ui/components/button';
import { Kbd } from 'coss-ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
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
