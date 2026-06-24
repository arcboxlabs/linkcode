import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { ServerIcon } from 'lucide-react';
import { DAEMON_URL } from '@/lib/transport';

/**
 * Sidebar footer identity slot. The webview connects to a local host with no
 * auth (PLAN §4), so instead of a user/account switcher this surfaces the host
 * connection — by the time the shell renders, the data plane is connected.
 */
export function HostStatus() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" tooltip="Local host">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-accent">
            <ServerIcon className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="flex items-center gap-1.5 truncate font-medium">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-emerald-500" />
              Connected
            </span>
            <span className="truncate text-muted-foreground text-xs">{DAEMON_URL}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
