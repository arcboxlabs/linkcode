import type { SidebarContextProps } from 'coss-ui/components/sidebar';
import { SidebarContext } from 'coss-ui/components/sidebar';
import { noop } from 'foxts/noop';
import { cn } from '../lib/cn';

// The shells own sidebar visibility and width, so the coss-ui menu primitives run against a
// fixed "expanded" context instead of `SidebarProvider` — the provider persists a cookie and
// binds a global ⌘B, both of which collide with the desktop shell (shortcut layer owns ⌘B).
const STATIC_SIDEBAR_CONTEXT: SidebarContextProps = {
  state: 'expanded',
  open: true,
  setOpen: noop,
  openMobile: false,
  setOpenMobile: noop,
  isMobile: false,
  toggleSidebar: noop,
};

export interface ShellSidebarProps {
  children: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
  topInset?: React.ReactNode;
}

export function ShellSidebar({
  children,
  className,
  footer,
  topInset,
}: ShellSidebarProps): React.ReactNode {
  return (
    <SidebarContext value={STATIC_SIDEBAR_CONTEXT}>
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
    </SidebarContext>
  );
}
