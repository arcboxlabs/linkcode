import type {
  AgentKind,
  SessionId,
  SessionInfo,
  SessionModeId,
  WorkspaceId,
} from '@linkcode/schema';
import { deleteSession, listSessions, resumeSession, startSession } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useMemo } from 'react';
import { useData, useMutation } from '../runtime/tayori';
import type { WorkbenchSessionDraft } from './selection-store';
import { useSessionSelectionStore } from './selection-store';

export interface WorkbenchSessions {
  sessions: SessionInfo[];
  /** The resolved active session — derived once here; consumers never re-derive it. */
  active: SessionInfo | null;
  activeId: SessionId | null;
  /** First load of the session list — the cue for the sidebar to show a skeleton, not an empty state. */
  isLoading: boolean;
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
  /** Stop the session if live and remove it from the list; re-importable from provider history. */
  close: (id: SessionId) => void;
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
  const closeMutation = useMutation(deleteSession, { onError });
  const resumeMutation = useMutation(resumeSession, { onError });
  const selectedId = useSessionSelectionStore((state) => state.selectedId);
  const setSelectedId = useSessionSelectionStore((state) => state.setSelectedId);
  const explicitDraft = useSessionSelectionStore((state) => state.draft);
  const startExplicitDraft = useSessionSelectionStore((state) => state.startDraft);

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
    startExplicitDraft({ workspaceId: workspaceId ?? null });
  }

  async function create(opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    modeId?: SessionModeId;
  }): Promise<SessionId> {
    // Rejections propagate to the caller (the new-session page stays up); onError above still
    // reports them via the error banner.
    const sessionId = await createMutation.trigger({ opts });
    // The list must contain the new session before selection flips: otherwise `active` falls
    // back to the previous session for a render and its conversation flashes (CODE-103).
    await mutate().catch(noop);
    setSelectedId(sessionId);
    return sessionId;
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
    draft,
    select,
    startDraft,
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
