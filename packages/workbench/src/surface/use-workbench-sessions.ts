import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import { listSessions, startSession, stopSession } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useSet } from 'foxact/use-set';
import { useMemo, useState } from 'react';
import { useData, useMutation } from '../runtime/tayori';

export interface WorkbenchSessions {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  select: (id: SessionId) => void;
  create: (opts: { kind: AgentKind; cwd: string }) => void;
  stop: (id: SessionId) => void;
}

export function useWorkbenchSessions(onError: (err: unknown) => void): WorkbenchSessions {
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

export function sessionById(
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
