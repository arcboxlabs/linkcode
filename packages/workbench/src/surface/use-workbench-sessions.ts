import type {
  AgentKind,
  EffortLevel,
  SessionId,
  SessionInfo,
  SessionModeId,
  WorkspaceId,
} from '@linkcode/schema';
import { deleteSession, listSessions, resumeSession, startSession } from '@linkcode/sdk';
import { withoutAutomationSessions } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useMemo, useRef } from 'react';
import type { NavLocation } from '../navigation/history';
import { useNavigationHistoryStore } from '../navigation/store';
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
  /** VS Code-style history traversal across threads and the new-thread draft. */
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  /** Starts the session and selects it; the returned id lets the caller chain the first prompt. */
  create: (opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    effort?: EffortLevel;
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
 * Session orchestration over the daemon's persisted session list: the daemon is the single
 * authority, so no client-side optimistic bookkeeping — mutations just revalidate. Selecting a
 * cold session resumes it in place (same id).
 */
export function useWorkbenchSessions(onError: (err: unknown) => void): WorkbenchSessions {
  const { data: remoteSessions, isLoading, mutate } = useData(listSessions, {});
  const createMutation = useMutation(startSession, { onError });
  const closeMutation = useMutation(deleteSession, { onError });
  const resumeMutation = useMutation(resumeSession, { onError });
  const selectedId = useSessionSelectionStore((state) => state.selectedId);
  const setSelectedId = useSessionSelectionStore((state) => state.setSelectedId);
  // Shared, not hook-local: a selection applied from another instance must clear the draft the
  // visible workbench renders, or the draft page wins over it.
  const explicitDraft = useSessionSelectionStore((state) => state.draft);
  const startExplicitDraft = useSessionSelectionStore((state) => state.startDraft);

  const sessions = useMemo(
    () => [...(remoteSessions ?? [])].sort((a, b) => a.createdAt - b.createdAt),
    [remoteSessions],
  );
  // Automation-created sessions are hidden from the Threads sidebar and the landing fallbacks; the
  // full `sessions` stays for explicit by-id resolution (an automation detail view opens its run).
  const visibleSessions = useMemo(() => withoutAutomationSessions(sessions), [sessions]);

  // The page is also the landing state once the list has loaded empty — there is nothing to
  // select, so the auto-select-recent fallback below would render a dead conversation column. An
  // all-automation list counts as empty for landing unless one was explicitly selected from its
  // run detail; explicit selections resolve against the full session list below.
  const listLoadedEmpty =
    !isLoading && remoteSessions != null && visibleSessions.length === 0 && selectedId === null;
  const draft = explicitDraft ?? (listLoadedEmpty ? EMPTY_LIST_DRAFT : null);

  const active = useMemo(() => {
    if (draft) return null;
    // An explicit selection absent from the loaded list must NOT fall back to a different thread
    // (wrong conversation). Hold null; the effect below refreshes the list so it resolves.
    if (selectedId) return sessionById(sessions, selectedId);
    return preferredActiveSession(visibleSessions) ?? visibleSessions.at(-1) ?? null;
  }, [draft, selectedId, sessions, visibleSessions]);
  const activeId = active?.sessionId ?? null;

  const recordNavigation = useNavigationHistoryStore((state) => state.record);
  const travelHistory = useNavigationHistoryStore((state) => state.travel);
  const canGoBack = useNavigationHistoryStore((state) => state.back.length > 0);
  const canGoForward = useNavigationHistoryStore((state) => state.forward.length > 0);
  const overlay = useNavigationHistoryStore((state) => state.overlay);
  const setOverlay = useNavigationHistoryStore((state) => state.setOverlay);

  // What the surface currently renders, as a history location: an overlay covers the draft page,
  // which wins over the fallback-resolved thread (mirroring the `active` derivation above).
  const currentLocation: NavLocation | null = overlay
    ? { surface: overlay }
    : draft
      ? { surface: 'new-thread', workspaceId: draft.workspaceId }
      : activeId
        ? { surface: 'thread', sessionId: activeId }
        : null;

  // Refresh the list once when an explicit selection isn't in it yet, so a click-through to a
  // not-yet-listed session resolves; deduped per id so a genuinely gone session doesn't spin.
  const refreshedForRef = useRef<SessionId | null>(null);
  useAbortableEffect(() => {
    if (selectedId == null || draft) return;
    if (sessionById(sessions, selectedId)) {
      refreshedForRef.current = null;
      return;
    }
    if (refreshedForRef.current === selectedId) return;
    refreshedForRef.current = selectedId;
    void mutate().catch(noop);
  }, [selectedId, draft, sessions, mutate]);

  /** The non-recording apply path, shared by explicit selection and history traversal. */
  function applySelection(id: SessionId): void {
    setOverlay(null);
    // setSelectedId atomically exits any draft (see the selection store).
    setSelectedId(id);
    // Selecting a cold session wakes it on the daemon, keeping the same Link Code id.
    if (sessionById(sessions, id)?.status === 'stopped') {
      void resumeMutation
        .trigger({ sessionId: id })
        .then(() => mutate())
        .catch(noop);
    }
  }

  function select(id: SessionId): void {
    recordNavigation(currentLocation, { surface: 'thread', sessionId: id });
    applySelection(id);
  }

  function startDraft(workspaceId?: WorkspaceId): void {
    recordNavigation(currentLocation, { surface: 'new-thread', workspaceId: workspaceId ?? null });
    setOverlay(null);
    startExplicitDraft({ workspaceId: workspaceId ?? null });
  }

  // Threads must still exist in the list to be traversal targets (closed ones drop out of the
  // stacks on the way); the draft page and the overlay surfaces are always reachable.
  function traverse(dir: 'back' | 'forward'): void {
    const target = travelHistory(dir, currentLocation, (location) =>
      location.surface === 'thread' ? sessionById(sessions, location.sessionId) !== null : true,
    );
    if (target === null) return;
    if (target.surface === 'thread') {
      applySelection(target.sessionId);
    } else if (target.surface === 'new-thread') {
      setOverlay(null);
      startExplicitDraft({ workspaceId: target.workspaceId });
    } else {
      // An overlay surface covers the current selection — raising it is the whole apply.
      setOverlay(target.surface);
    }
  }

  function goBack(): void {
    traverse('back');
  }

  function goForward(): void {
    traverse('forward');
  }

  async function create(opts: {
    kind: AgentKind;
    cwd: string;
    model?: string;
    effort?: EffortLevel;
    modeId?: SessionModeId;
  }): Promise<SessionId> {
    // Captured now: by resolve time the surface still shows the draft, and the recorded
    // transition should be draft → new thread.
    const from = currentLocation;
    // Rejections propagate to the caller (the new-session page stays up); onError above still
    // reports them via the error banner.
    const sessionId = await createMutation.trigger({ opts });
    // The list must contain the new session before selection flips: otherwise `active` falls
    // back to the previous session for a render and its conversation flashes (CODE-103).
    await mutate().catch(noop);
    recordNavigation(from, { surface: 'thread', sessionId });
    // setSelectedId atomically exits the draft (see the selection store).
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
    // The sidebar and keyboard-recent cycle see only non-automation sessions.
    sessions: visibleSessions,
    active,
    activeId,
    isLoading,
    draft,
    select,
    startDraft,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
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
