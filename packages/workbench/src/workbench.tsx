import { useConversation } from '@linkcode/client-core';
import type { AgentKind, SessionId, SessionInfo, TokenUsage } from '@linkcode/schema';
import {
  cancelTurn,
  listSessions,
  promptText,
  respondPermission,
  startSession,
  stopSession,
} from '@linkcode/sdk';
import type { WorkbenchFrameProps } from '@linkcode/ui';
import { TitleStrip, WorkbenchFrame } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useData, useMutation } from './tayori';

export interface WorkbenchProps {
  shellComponent?: WorkbenchShellComponent;
}

export interface WorkbenchShellHeader {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
}

export interface WorkbenchShellProps extends Omit<WorkbenchFrameProps, 'header'> {
  header: WorkbenchShellHeader;
}

export type WorkbenchShellComponent = (props: WorkbenchShellProps) => React.ReactNode;

/**
 * The workbench feature surface: session inbox + conversation stream + composer.
 *
 * It assumes the data plane is already mounted above it (transport client,
 * `TayoriProvider`, `SWRConfig`, and `LinkCodeProvider`) — see `WorkbenchProviders`.
 * Wrap it in `WorkbenchProviders` (at a layout, or inline) and mount it as a
 * routed feature page.
 */
export function Workbench({
  shellComponent: ShellComponent = DefaultWorkbenchShell,
}: WorkbenchProps): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  function handleError(err: unknown): void {
    setErrorMessage(extractErrorMessage(err));
  }

  const sessions = useWorkbenchSessions(handleError);
  const conversation = useConversation(sessions.activeId);

  return (
    <WorkbenchSessionSurface
      key={sessions.activeId ?? 'no-active-session'}
      sessions={sessions}
      conversation={conversation}
      errorMessage={errorMessage}
      ShellComponent={ShellComponent}
      onClearError={() => setErrorMessage(null)}
      onError={handleError}
    />
  );
}

interface WorkbenchSessionSurfaceProps {
  sessions: WorkbenchSessions;
  conversation: ReturnType<typeof useConversation>;
  errorMessage: string | null;
  ShellComponent: WorkbenchShellComponent;
  onClearError: () => void;
  onError: (err: unknown) => void;
}

function WorkbenchSessionSurface({
  sessions,
  conversation,
  errorMessage,
  ShellComponent,
  onClearError,
  onError,
}: WorkbenchSessionSurfaceProps): React.ReactNode {
  const tk = useTranslations('workbench.agentKind');
  const promptMutation = useMutation(promptText, { onError });
  const cancelMutation = useMutation(cancelTurn, { onError });
  const permissionMutation = useMutation(respondPermission, { onError });
  const [answered, addAnswered] = useSet<string>();
  const [responding, addResponding, removeResponding] = useSet<string>();
  const active = sessionById(sessions.sessions, sessions.activeId);

  function handleSend(text: string): void {
    if (!sessions.activeId) return;
    onClearError();
    void promptMutation.trigger({ sessionId: sessions.activeId, text }).catch(noop);
  }

  function handleStopTurn(): void {
    if (!sessions.activeId) return;
    onClearError();
    void cancelMutation.trigger({ sessionId: sessions.activeId }).catch(noop);
  }

  function handleRespond(requestId: string, optionId: string): void {
    if (!sessions.activeId) return;
    onClearError();
    addResponding(requestId);
    void permissionMutation
      .trigger({
        sessionId: sessions.activeId,
        requestId,
        outcome: { outcome: 'selected', optionId },
      })
      .then(() => {
        addAnswered(requestId);
      })
      .catch(noop)
      .finally(() => {
        removeResponding(requestId);
      });
  }

  return (
    <ShellComponent
      sessions={sessions.sessions}
      activeId={sessions.activeId}
      conversation={conversation}
      answeredPermissions={answered}
      respondingPermissions={responding}
      header={{
        title: active ? tk(active.kind) : 'Link Code',
        subtitle: active?.cwd,
        usage: conversation.usage,
      }}
      errorMessage={errorMessage}
      onSelectSession={sessions.select}
      onStopSession={sessions.stop}
      onCreateSession={sessions.create}
      onSendPrompt={handleSend}
      onStopTurn={handleStopTurn}
      onRespondPermission={handleRespond}
      onDismissError={onClearError}
    />
  );
}

function DefaultWorkbenchShell({ header, ...props }: WorkbenchShellProps): React.ReactNode {
  return <WorkbenchFrame {...props} header={<DefaultTitleStrip header={header} />} />;
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

interface WorkbenchSessions {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  select: (id: SessionId) => void;
  create: (opts: { kind: AgentKind; cwd: string }) => void;
  stop: (id: SessionId) => void;
}

function useWorkbenchSessions(onError: (err: unknown) => void): WorkbenchSessions {
  const { data: remoteSessions, mutate } = useData(listSessions, {});
  const createMutation = useMutation(startSession, { onError });
  const stopMutation = useMutation(stopSession, { onError });
  const [localSessions, setLocalSessions] = useState<SessionInfo[]>([]);
  const [stoppedIds, addStoppedId, removeStoppedId] = useSet<SessionId>();
  const [selectedId, setSelectedId] = useState<SessionId | null>(null);

  const sessions = useMemo(() => {
    const byId = new Map<SessionId, SessionInfo>();
    for (const session of remoteSessions ?? []) {
      if (!stoppedIds.has(session.sessionId)) byId.set(session.sessionId, session);
    }
    for (const session of localSessions) {
      if (!stoppedIds.has(session.sessionId)) byId.set(session.sessionId, session);
    }
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [localSessions, remoteSessions, stoppedIds]);

  const activeId = useMemo(() => {
    if (selectedId && sessionById(sessions, selectedId)) {
      return selectedId;
    }

    const preferred = preferredActiveSession(sessions) ?? sessions.at(-1);
    return preferred?.sessionId ?? null;
  }, [selectedId, sessions]);

  function create(opts: { kind: AgentKind; cwd: string }): void {
    void createMutation
      .trigger({ opts })
      .then((sessionId) => {
        const optimistic: SessionInfo = {
          sessionId,
          kind: opts.kind,
          cwd: opts.cwd,
          status: 'starting',
          createdAt: Date.now(),
        };
        removeStoppedId(sessionId);
        setLocalSessions((prev) =>
          prev.some((session) => session.sessionId === sessionId) ? prev : [...prev, optimistic],
        );
        setSelectedId(sessionId);
        void mutate();
      })
      .catch(noop);
  }

  function stop(id: SessionId): void {
    void stopMutation
      .trigger({ sessionId: id })
      .then(() => {
        addStoppedId(id);
        setLocalSessions((prev) => prev.filter((session) => session.sessionId !== id));
        setSelectedId((current) => (current === id ? null : current));
        void mutate();
      })
      .catch(noop);
  }

  return {
    sessions,
    activeId,
    select: setSelectedId,
    create,
    stop,
  };
}

function sessionById(
  sessions: readonly SessionInfo[],
  sessionId: SessionId | null,
): SessionInfo | null {
  if (!sessionId) return null;
  for (const session of sessions) {
    if (session.sessionId === sessionId) return session;
  }
  return null;
}

function preferredActiveSession(sessions: readonly SessionInfo[]): SessionInfo | null {
  for (const session of sessions) {
    if (session.status === 'running' || session.status === 'awaiting-input') return session;
  }
  return null;
}
