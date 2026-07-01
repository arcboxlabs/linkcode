import { Button } from 'coss-ui/components/button';
import type { ComponentProps, CSSProperties, MouseEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';

type ShellFrameStyle = CSSProperties & Partial<Record<`--${string}`, string | number>>;

// Shared row styling for shell sidebars; settings should only layer icons/content on top.
export const shellSidebarItemClassName =
  'flex h-8 w-full items-center gap-[var(--lc-sidebar-gap,0.5rem)] rounded-md px-[var(--lc-sidebar-edge,0.5rem)] text-left font-normal text-sidebar-foreground text-sm outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground sm:h-8';

export interface ShellFrameProps {
  sidebar: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
  sidebarClassName?: string;
  style?: ShellFrameStyle;
}

export function ShellFrame({
  sidebar,
  children,
  className,
  mainClassName,
  sidebarClassName,
  style,
}: ShellFrameProps): ReactNode {
  return (
    <div
      className={cn('flex h-full min-h-0 bg-background text-foreground', className)}
      style={style}
    >
      <div className={cn('w-72 shrink-0', sidebarClassName)}>{sidebar}</div>
      <main className={cn('flex min-w-0 flex-1 flex-col bg-background', mainClassName)}>
        {children}
      </main>
    </div>
  );
}

export interface ShellSidebarProps {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  topInset?: ReactNode;
}

export function ShellSidebar({
  children,
  className,
  footer,
  topInset,
}: ShellSidebarProps): ReactNode {
  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      {topInset}
      {children}
      {footer}
    </aside>
  );
}

export interface ShellSidebarItemProps
  extends Omit<ComponentProps<typeof Button>, 'size' | 'variant'> {
  active?: boolean;
}

export function ShellSidebarItem({
  active = false,
  className,
  children,
  disabled,
  onClick,
  render,
  ...props
}: ShellSidebarItemProps): ReactNode {
  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (disabled && render) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <Button
      render={render}
      size="sm"
      variant="ghost"
      data-active={active ? 'true' : undefined}
      aria-current={active ? 'page' : props['aria-current']}
      aria-disabled={disabled && render ? true : props['aria-disabled']}
      disabled={render ? undefined : disabled}
      className={cn(
        shellSidebarItemClassName,
        'justify-start border-transparent shadow-none',
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </Button>
  );
}
