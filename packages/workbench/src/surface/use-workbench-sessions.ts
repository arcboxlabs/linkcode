import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import { deleteSession, listSessions, resumeSession, startSession } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useMemo } from 'react';
import { useData, useMutation } from '../runtime/tayori';
import { useSessionSelectionStore } from './selection-store';

export interface WorkbenchSessions {
  sessions: SessionInfo[];
  /** The resolved active session — derived once here; consumers never re-derive it. */
  active: SessionInfo | null;
  activeId: SessionId | null;
  /** First load of the session list — the cue for the sidebar to show a skeleton, not an empty state. */
  isLoading: boolean;
  select: (id: SessionId) => void;
  create: (opts: { kind: AgentKind; cwd: string }) => void;
  /** Stop the session if live and remove it from the list; re-importable from provider history. */
  close: (id: SessionId) => void;
  /** Revalidate the session list — the cue for a mutation made outside this hook (e.g. an import). */
  refresh: () => void;
}

/**
 * Session orchestration over the daemon's persisted session list. The daemon is the single
 * authority — the list includes cold (stopped) sessions, so there is no client-side optimistic
 * bookkeeping; mutations just revalidate. Selecting a cold session resumes it in place (same id).
 */
export function useWorkbenchSessions(onError: (err: unknown) => void): WorkbenchSessions {
  const { data: remoteSessions, isLoading, mutate } = useData(listSessions, {});
  const createMutation = useMutation(startSession, { onError });
  const closeMutation = useMutation(deleteSession, { onError });
  const resumeMutation = useMutation(resumeSession, { onError });
  const selectedId = useSessionSelectionStore((state) => state.selectedId);
  const setSelectedId = useSessionSelectionStore((state) => state.setSelectedId);

  const sessions = useMemo(
    () => [...(remoteSessions ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [remoteSessions],
  );

  const active = useMemo(() => {
    if (selectedId) {
      const selected = sessionById(sessions, selectedId);
      if (selected) return selected;
    }

    return preferredActiveSession(sessions) ?? sessions.at(-1) ?? null;
  }, [selectedId, sessions]);
  const activeId = active?.sessionId ?? null;

  function select(id: SessionId): void {
    setSelectedId(id);
    // Selecting a cold session wakes it on the daemon, keeping the same Link Code id.
    if (sessionById(sessions, id)?.status === 'stopped') {
      void resumeMutation
        .trigger({ sessionId: id })
        .then(() => mutate())
        .catch(noop);
    }
  }

  function create(opts: { kind: AgentKind; cwd: string }): void {
    void createMutation
      .trigger({ opts })
      .then((sessionId) => {
        setSelectedId(sessionId);
        void mutate();
      })
      .catch(noop);
  }

  function close(id: SessionId): void {
    void closeMutation
      .trigger({ sessionId: id })
      .then(() => {
        void mutate();
      })
      .catch(noop);
  }

  function refresh(): void {
    void mutate();
  }

  return {
    sessions,
    active,
    activeId,
    isLoading,
    select,
    create,
    close,
    refresh,
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
