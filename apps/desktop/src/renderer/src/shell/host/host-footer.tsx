import type { SystemBridge } from '@linkcode/ipc';
import { Avatar, AvatarFallback } from 'coss-ui/components/avatar';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Separator } from 'coss-ui/components/separator';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { ChevronDownIcon, SettingsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

const ORGS = [{ label: 'ArcBox Labs', value: 'arcbox' }];

export function DesktopHostFooter({
  systemBridge,
  pendingPermissionCount,
}: {
  systemBridge: SystemBridge;
  pendingPermissionCount: number;
}): ReactNode {
  const [version, setVersion] = useState('v0.0.0');
  const pendingPermissionLabel =
    pendingPermissionCount === 1 ? '1 pending' : `${pendingPermissionCount} pending`;

  useAbortableEffect(
    (signal) => {
      void systemBridge.app.version().then((value) => {
        if (!signal.aborted) setVersion(`v${value}`);
      });
    },
    [systemBridge],
  );

  return (
    <Popover>
      <PopoverTrigger className="flex h-10 w-full items-center gap-(--lc-chrome-section-gap) border-sidebar-border border-t px-(--lc-chrome-edge) text-left text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
        <span className="size-2 rounded-full bg-success" />
        <span className="font-medium text-sidebar-foreground">Local Host</span>
        <span className="text-muted-foreground">Connected</span>
        <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" sideOffset={8} className="w-80 text-sm">
        <div className="flex items-center gap-2 py-1.5">
          <span className="size-2 rounded-full bg-success" />
          <span className="font-semibold">Local Host</span>
          <Badge size="sm" variant="success">
            Connected
          </Badge>
          <span className="ml-auto font-mono text-muted-foreground text-xs">{version}</span>
        </div>

        <Separator className="my-1" />

        <HostRow label="Remote access">
          <Badge size="sm" variant="secondary">
            Off
          </Badge>
          <Button disabled size="xs" variant="outline">
            Enable
          </Button>
        </HostRow>
        <HostRow label="Permission requests">
          <span className="text-muted-foreground text-xs">{pendingPermissionLabel}</span>
        </HostRow>

        <Separator className="my-1" />

        <HostRow label="Agent availability">
          <span className="text-muted-foreground text-xs">Not reported</span>
        </HostRow>

        <Separator className="my-1" />

        <div className="flex items-center gap-2 pt-1">
          <Select defaultValue="arcbox" items={ORGS}>
            <SelectTrigger disabled aria-label="Workspace" className="min-w-0 flex-1" size="sm">
              <Avatar className="size-5 rounded-sm">
                <AvatarFallback className="rounded-sm bg-primary text-primary-foreground">
                  A
                </AvatarFallback>
              </Avatar>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {ORGS.map((org) => (
                <SelectItem key={org.value} value={org.value}>
                  {org.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button disabled size="icon-sm" variant="outline" aria-label="Settings">
            <SettingsIcon />
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function HostRow({ label, children }: { label: string; children?: ReactNode }): ReactNode {
  return (
    <div className="flex h-8 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
}
