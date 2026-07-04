import type {
  AgentKind,
  SessionId,
  SessionInfo,
  SessionModeId,
  WorkspaceId,
} from '@linkcode/schema';
import { listSessions, resumeSession, startSession, stopSession } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useMemo, useState } from 'react';
import { useData, useMutation } from '../runtime/tayori';

export interface WorkbenchSessionDraft {
  /** Explicit workspace preselection (group "+", Chats "+"); null = resolve the default. */
  workspaceId: WorkspaceId | null;
}

export interface WorkbenchSessions {
  sessions: SessionInfo[];
  /** The resolved active session — derived once here; consumers never re-derive it. */
  active: SessionInfo | null;
  activeId: SessionId | null;
  /** Non-null while the new-session page is up (explicitly opened, or the list loaded empty);
   * `active` is forced null for its duration. Selecting or creating a session clears it. */
  draft: WorkbenchSessionDraft | null;
  select: (id: SessionId) => void;
  startDraft: (workspaceId?: WorkspaceId) => void;
  /** Starts the session and selects it; the returned id lets the caller chain the first prompt. */
  create: (opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    modeId?: SessionModeId;
  }) => Promise<SessionId>;
  stop: (id: SessionId) => void;
  /** Revalidate the session list — the cue for a mutation made outside this hook (e.g. an import). */
  refresh: () => void;
}

/** The loaded-empty landing draft — module-level so its identity is stable across renders. */
const EMPTY_LIST_DRAFT: WorkbenchSessionDraft = { workspaceId: null };

/**
 * Session orchestration over the daemon's persisted session list. The daemon is the single
 * authority — the list includes cold (stopped) sessions, so there is no client-side optimistic
 * bookkeeping; mutations just revalidate. Selecting a cold session resumes it in place (same id).
 */
export function useWorkbenchSessions(onError: (err: unknown) => void): WorkbenchSessions {
  const { data: remoteSessions, isLoading, mutate } = useData(listSessions, {});
  const createMutation = useMutation(startSession, { onError });
  const stopMutation = useMutation(stopSession, { onError });
  const resumeMutation = useMutation(resumeSession, { onError });
  const [selectedId, setSelectedId] = useState<SessionId | null>(null);
  const [explicitDraft, setExplicitDraft] = useState<WorkbenchSessionDraft | null>(null);

  const sessions = useMemo(
    () => [...(remoteSessions ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [remoteSessions],
  );

  // The page is also the landing state once the list has loaded empty — there is nothing to
  // select, so the auto-select-recent fallback below would render a dead conversation column.
  const listLoadedEmpty = !isLoading && remoteSessions != null && sessions.length === 0;
  const draft = explicitDraft ?? (listLoadedEmpty ? EMPTY_LIST_DRAFT : null);

  const active = useMemo(() => {
    if (draft) return null;
    if (selectedId) {
      const selected = sessionById(sessions, selectedId);
      if (selected) return selected;
    }

    return preferredActiveSession(sessions) ?? sessions.at(-1) ?? null;
  }, [draft, selectedId, sessions]);
  const activeId = active?.sessionId ?? null;

  function select(id: SessionId): void {
    setExplicitDraft(null);
    setSelectedId(id);
    // Selecting a cold session wakes it on the daemon, keeping the same Link Code id.
    if (sessionById(sessions, id)?.status === 'stopped') {
      void resumeMutation
        .trigger({ sessionId: id })
        .then(() => mutate())
        .catch(noop);
    }
  }

  function startDraft(workspaceId?: WorkspaceId): void {
    setExplicitDraft({ workspaceId: workspaceId ?? null });
  }

  function create(opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    modeId?: SessionModeId;
  }): Promise<SessionId> {
    // Rejections propagate to the caller (the new-session page stays up); onError above still
    // reports them via the error banner.
    return createMutation.trigger({ opts }).then((sessionId) => {
      setExplicitDraft(null);
      setSelectedId(sessionId);
      void mutate();
      return sessionId;
    });
  }

  function stop(id: SessionId): void {
    void stopMutation
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
    draft,
    select,
    startDraft,
    create,
    stop,
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
