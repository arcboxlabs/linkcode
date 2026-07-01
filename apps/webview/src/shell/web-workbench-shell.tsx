import { TitleStrip, WorkbenchFrame } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { SettingsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function WebWorkbenchShell({ header, ...props }: WorkbenchShellProps): ReactNode {
  return (
    <WorkbenchFrame
      {...props}
      header={
        <TitleStrip className="border-border border-b">
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">{header.title}</div>
            {header.subtitle && (
              <div className="truncate text-muted-foreground text-xs">{header.subtitle}</div>
            )}
          </div>
          <Button
            render={<Link to="/settings" />}
            size="icon-sm"
            variant="ghost"
            aria-label="Settings"
            className="ml-auto"
          >
            <SettingsIcon />
          </Button>
        </TitleStrip>
      }
    />
  );
}
