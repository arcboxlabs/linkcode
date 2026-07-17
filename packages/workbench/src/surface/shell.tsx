import type { TokenUsage } from '@linkcode/schema';
import type { ComposerAttachment, ShellFrameProps } from '@linkcode/ui';
import { ErrorBadge, ShellFrame, TitleStrip } from '@linkcode/ui';

export interface WorkbenchShellHeader {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
}

/** History traversal for the shell's ‹ › controls (VS Code-style back/forward). */
export interface WorkbenchShellNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/** The contract between the workbench surface and an app-provided shell (e.g. desktop's). */
export interface WorkbenchShellProps extends Omit<ShellFrameProps, 'header'> {
  header: WorkbenchShellHeader;
  navigation: WorkbenchShellNavigation;
  /** Reads a natively-picked attachment path via the daemon. Only a shell that supplies its own
   * native picker trigger (desktop) can use it — the bare fallback shell drops it. */
  onReadAttachmentFile?: (path: string) => Promise<ComposerAttachment>;
}

export type WorkbenchShellComponent = (props: WorkbenchShellProps) => React.ReactNode;

// `navigation` and `onReadAttachmentFile` are deliberately dropped: the bare fallback shell has
// no chrome controls or native picker — app shells own the ‹ › buttons and picker composition.
export function DefaultWorkbenchShell({
  header,
  navigation,
  onReadAttachmentFile,
  ...props
}: WorkbenchShellProps): React.ReactNode {
  return (
    <ShellFrame
      {...props}
      header={
        <DefaultTitleStrip
          header={header}
          // The draft page reports errors through its own banner (it has no meaningful title).
          errorMessage={props.draft ? null : props.errorMessage}
          onDismissError={props.onDismissError}
        />
      }
    />
  );
}

function DefaultTitleStrip({
  header,
  errorMessage,
  onDismissError,
}: {
  header: WorkbenchShellHeader;
  errorMessage?: string | null;
  onDismissError?: () => void;
}): React.ReactNode {
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
      <ErrorBadge errorMessage={errorMessage} onDismissError={onDismissError} />
      {hasUsage && (
        <span className="ml-auto font-mono text-muted-foreground text-xs">
          {header.usage?.inputTokens ?? 0} in / {header.usage?.outputTokens ?? 0} out
        </span>
      )}
    </TitleStrip>
  );
}
