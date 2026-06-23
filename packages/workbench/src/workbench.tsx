import { useConversation } from '@linkcode/client-core';
import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import {
  cancelTurn,
  listSessions,
  promptText,
  respondPermission,
  startSession,
  stopSession,
} from '@linkcode/sdk';
import { AppShell, type WorkbenchSystemBridge } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { type ReactElement, useMemo, useState } from 'react';
import { useData, useMutation } from './tayori';

export interface WorkbenchProps {
  systemBridge?: WorkbenchSystemBridge;
}

/**
 * The workbench feature surface: session inbox + conversation stream + composer.
 *
 * It assumes the data plane is already mounted above it (transport client,
 * `TayoriProvider`, `SWRConfig`, and `LinkCodeProvider`) — see `WorkbenchProviders`.
 * Wrap it in `WorkbenchProviders` (at a layout, or inline) and mount it as a
 * routed feature page.
 */
export function Workbench({ systemBridge }: WorkbenchProps): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  function handleError(err: unknown): void {
    setErrorMessage(extractErrorMessage(err) ?? String(err));
  }

  const sessions = useWorkbenchSessions(handleError);
  const conversation = useConversation(sessions.activeId);

  return (
    <WorkbenchSessionSurface
      key={sessions.activeId ?? 'no-active-session'}
      sessions={sessions}
      conversation={conversation}
      errorMessage={errorMessage}
      systemBridge={systemBridge}
      onClearError={() => setErrorMessage(null)}
      onError={handleError}
    />
  );
}

interface WorkbenchSessionSurfaceProps {
  sessions: WorkbenchSessions;
  conversation: ReturnType<typeof useConversation>;
  errorMessage: string | null;
  systemBridge?: WorkbenchSystemBridge;
  onClearError: () => void;
  onError: (err: unknown) => void;
}

function WorkbenchSessionSurface({
  sessions,
  conversation,
  errorMessage,
  systemBridge,
  onClearError,
  onError,
}: WorkbenchSessionSurfaceProps): ReactElement {
  const promptMutation = useMutation(promptText, { onError });
  const cancelMutation = useMutation(cancelTurn, { onError });
  const permissionMutation = useMutation(respondPermission, { onError });
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [responding, setResponding] = useState<Set<string>>(new Set());

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
    setResponding((prev) => new Set(prev).add(requestId));
    void permissionMutation
      .trigger({
        sessionId: sessions.activeId,
        requestId,
        outcome: { outcome: 'selected', optionId },
      })
      .then(() => {
        setAnswered((prev) => new Set(prev).add(requestId));
      })
      .catch(noop)
      .finally(() => {
        setResponding((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      });
  }

  return (
    <AppShell
      sessions={sessions.sessions}
      activeId={sessions.activeId}
      conversation={conversation}
      answeredPermissions={answered}
      respondingPermissions={responding}
      errorMessage={errorMessage}
      systemBridge={systemBridge}
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
  const [stoppedIds, setStoppedIds] = useState<Set<SessionId>>(new Set());
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
    if (selectedId && sessions.some((session) => session.sessionId === selectedId)) {
      return selectedId;
    }

    const preferred =
      sessions.find(
        (session) => session.status === 'running' || session.status === 'awaiting-input',
      ) ?? sessions.at(-1);
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
        setStoppedIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
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
        setStoppedIds((prev) => new Set(prev).add(id));
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
