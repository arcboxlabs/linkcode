import { ShellFrame, TitleStrip } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import { Button } from 'coss-ui/components/button';
import { SettingsIcon } from 'lucide-react';
import { Link } from 'react-router';

export function WebWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  const hasUsage =
    header.usage != null && (header.usage.inputTokens != null || header.usage.outputTokens != null);

  return (
    <ShellFrame
      {...props}
      header={
        <TitleStrip className="border-border border-b">
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">{header.title}</div>
            {header.subtitle && (
              <div className="truncate text-muted-foreground text-xs">{header.subtitle}</div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {hasUsage && (
              <span className="font-mono text-muted-foreground text-xs">
                {header.usage?.inputTokens ?? 0} in / {header.usage?.outputTokens ?? 0} out
              </span>
            )}
            <Button
              render={<Link to="/settings" />}
              size="icon-sm"
              variant="ghost"
              aria-label="Settings"
            >
              <SettingsIcon />
            </Button>
          </div>
        </TitleStrip>
      }
    />
  );
}
