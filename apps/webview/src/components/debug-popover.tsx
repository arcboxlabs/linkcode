import { useDebug } from '@linkcode/workbench';
import { Label } from 'coss-ui/components/label';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { Switch } from 'coss-ui/components/switch';
import { BugIcon } from 'lucide-react';

/**
 * Dev-only toggles for the workbench data plane's debug middleware (artificial
 * latency + forced loading state). Wired to the same `useDebug` context the
 * `WorkbenchProviders` SWR middleware reads.
 */
export function DebugPopover() {
  const { enableArtificialDelay, isLoadingOverride, setEnableArtificialDelay, setIsLoadingOverride } = useDebug();

  if (import.meta.env.PROD) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Popover>
          <PopoverTrigger
            render={
              <SidebarMenuButton tooltip="Debug">
                <BugIcon />
                <span>Debug</span>
              </SidebarMenuButton>
            }
          />
          <PopoverPopup align="center" className="w-64" side="top">
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="delay-switch">Enable artificial delay</Label>
                <Switch checked={enableArtificialDelay} id="delay-switch" onCheckedChange={setEnableArtificialDelay} />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="loading-switch">Force loading state</Label>
                <Switch checked={isLoadingOverride} id="loading-switch" onCheckedChange={setIsLoadingOverride} />
              </div>
            </div>
          </PopoverPopup>
        </Popover>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
