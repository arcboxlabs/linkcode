import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import { DefaultHostFooter, SessionSidebar } from './session-sidebar';

export interface ShellFrameProps {
  sessions: SessionInfo[];
  /** Derived once by the workbench surface; shells consume it instead of re-deriving from the list. */
  activeSession: SessionInfo | null;
  header?: React.ReactNode;
  /** The session-scoped content (conversation + composer), owned and keyed by the workbench surface. */
  main: React.ReactNode;
  onSelectSession: (id: SessionId) => void;
  onStopSession: (id: SessionId) => void;
  onCreateSession: (opts: { kind: AgentKind; cwd: string }) => void;
}

export function ShellFrame({
  sessions,
  activeSession,
  header,
  main,
  onSelectSession,
  onStopSession,
  onCreateSession,
}: ShellFrameProps): React.ReactNode {
  const active = activeSession;
  const fallbackCwd = active?.cwd ?? sessions.at(0)?.cwd ?? '/';

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <div className="w-72 shrink-0">
        <SessionSidebar
          sessions={sessions}
          activeId={active?.sessionId ?? null}
          footer={<DefaultHostFooter />}
          onSelect={onSelectSession}
          onStop={onStopSession}
          onCreate={(kind) => onCreateSession({ kind, cwd: fallbackCwd })}
        />
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="min-h-0 flex-1">{main}</div>
      </main>
    </div>
  );
}
