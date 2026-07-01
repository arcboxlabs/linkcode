import type { TokenUsage } from '@linkcode/schema';
import type { ShellFrameProps } from '@linkcode/ui';
import { ShellFrame, TitleStrip } from '@linkcode/ui';

export interface WorkbenchShellHeader {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
}

/** The contract between the workbench surface and an app-provided shell (e.g. desktop's). */
export interface WorkbenchShellProps extends Omit<ShellFrameProps, 'header'> {
  header: WorkbenchShellHeader;
}

export type WorkbenchShellComponent = (props: WorkbenchShellProps) => React.ReactNode;

export function DefaultWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  return <ShellFrame {...props} header={<DefaultTitleStrip header={header} />} />;
}

function DefaultTitleStrip({ header }: { header: WorkbenchShellHeader }): React.ReactNode {
  const hasUsage =
    header.usage != null && (header.usage.inputTokens != null || header.usage.outputTokens != null);

  return (
    <TitleStrip className="border-border border-b">
      <div className="min-w-0">
        <div className="truncate font-medium text-sm">{header.title}</div>
        {header.subtitle && (
          <div className="truncate text-muted-foreground text-xs">{header.subtitle}</div>
        )}
      </div>
      {hasUsage && (
        <span className="ml-auto font-mono text-muted-foreground text-xs">
          {header.usage?.inputTokens ?? 0} in / {header.usage?.outputTokens ?? 0} out
        </span>
      )}
    </TitleStrip>
  );
}
