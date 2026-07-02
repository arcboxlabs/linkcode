import type { AgentKind, SessionId, SessionInfo, TokenUsage } from '@linkcode/schema';
import { ShellFrame, TitleStrip } from '@linkcode/ui';

export interface WorkbenchShellHeader {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
}

/**
 * The contract between the workbench surface and an app-provided shell (e.g. desktop's).
 *
 * The shell is session-agnostic layout that mounts once: it receives the session inbox, narrow
 * header/badge view-models, and the session-scoped view as the pre-built `main` slot. Everything
 * that changes per conversation (stream, composer, permissions) lives inside `main`, so switching
 * sessions never remounts the shell.
 */
export interface WorkbenchShellProps {
  sessions: SessionInfo[];
  /** Derived once by the workbench surface; shells consume it instead of re-deriving from the list. */
  activeSession: SessionInfo | null;
  header: WorkbenchShellHeader;
  /** Unanswered permission requests in the active conversation (badge count). */
  pendingPermissionCount: number;
  /** The session-scoped view (conversation + composer), keyed by session — mount it as-is. */
  main: React.ReactNode;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
}

export type WorkbenchShellComponent = (props: WorkbenchShellProps) => React.ReactNode;

export function DefaultWorkbenchShell({
  header,
  pendingPermissionCount: _pendingPermissionCount,
  ...props
}: WorkbenchShellProps): React.ReactNode {
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
