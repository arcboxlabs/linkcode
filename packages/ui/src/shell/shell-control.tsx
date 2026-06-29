import { Button } from 'coss-ui/components/button';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type ShellIconButtonProps = ComponentProps<typeof Button> & {
  label: string;
};

export function ShellIconButton({
  label,
  className,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: ShellIconButtonProps): ReactNode {
  return (
    <Button
      aria-label={label}
      className={cn(
        'pointer-events-auto text-muted-foreground hover:text-foreground [-webkit-app-region:no-drag]',
        className,
      )}
      size={size}
      title={label}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
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
}: PanelControlButtonProps): ReactNode {
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
  children: ReactNode;
}): ReactNode {
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
