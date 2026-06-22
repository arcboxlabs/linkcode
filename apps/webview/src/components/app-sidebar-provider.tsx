import type { SidebarContextProps } from 'coss-ui/components/sidebar';
import { SidebarContext } from 'coss-ui/components/sidebar';
import { useMediaQuery } from 'coss-ui/hooks/use-media-query';
import { cn } from 'coss-ui/lib/utils';
import { useLocalStorage } from 'foxact/use-local-storage';
import { useCallback, useMemo, useState } from 'react';

interface SidebarStateProviderProps extends React.ComponentProps<'div'> {
  storageKey: string;
  defaultOpen?: boolean;
}

/**
 * Sidebar open/collapse state provider with persistence. Owns the coss-ui
 * `SidebarContext` so the dashboard shell and the filterable table layout can
 * each have an independently persisted sidebar (keyed by `storageKey`).
 */
export function AppSidebarProvider({
  storageKey,
  defaultOpen = true,
  className,
  style,
  children,
  ...props
}: SidebarStateProviderProps) {
  const isMobile = useMediaQuery('max-md');
  const [openMobile, setOpenMobile] = useState(false);
  const [open, setOpen] = useLocalStorage(storageKey, defaultOpen);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile((prev) => !prev);
    } else {
      setOpen((prev) => !(prev ?? defaultOpen));
    }
  }, [isMobile, setOpen, defaultOpen]);

  const ctx = useMemo<SidebarContextProps>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen: (value: boolean) => setOpen(value),
      openMobile,
      setOpenMobile,
      isMobile,
      toggleSidebar,
    }),
    [open, setOpen, isMobile, openMobile, toggleSidebar],
  );

  return (
    <SidebarContext value={ctx}>
      <div
        className={cn('group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar', className)}
        data-slot="sidebar-wrapper"
        data-state={ctx.state}
        style={
          {
            '--sidebar-width': '16rem',
            '--sidebar-width-icon': '3rem',
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext>
  );
}
