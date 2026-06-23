import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from 'coss-ui/components/sidebar';
import { TooltipProvider } from 'coss-ui/components/tooltip';
import { TerminalIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { DebugPopover } from '@/components/debug-popover';
import { HostStatus } from '@/components/host-status';
import { sidebarNav } from '@/constants/navigation-data';
import type { NavItem } from '@/constants/navigation-data';

function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.matchPath) {
    return pathname === item.matchPath || pathname.startsWith(`${item.matchPath}/`);
  }
  return pathname === item.url;
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation();

  return (
    // Group tooltips so they appear instantly after the first opens.
    <TooltipProvider delay={300}>
      <Sidebar collapsible="icon" variant="inset" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link to="/" />}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <TerminalIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Link Code</span>
                  <span className="truncate text-muted-foreground text-xs">Unified GUI</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="h-full">
          {sidebarNav.map((section) => (
            <SidebarGroup key={section.label ?? 'primary'}>
              {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      isActive={isItemActive(item, pathname)}
                      tooltip={item.title}
                      render={<Link to={item.url} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <DebugPopover />
          <HostStatus />
        </SidebarFooter>
      </Sidebar>
    </TooltipProvider>
  );
}
