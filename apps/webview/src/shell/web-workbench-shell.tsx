import { TitleStrip, WorkbenchFrame } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';

export function WebWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
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
        </TitleStrip>
      }
    />
  );
}
