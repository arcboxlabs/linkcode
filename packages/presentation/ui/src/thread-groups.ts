import type { SessionId, SessionInfo, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey, workspaceKind } from '@linkcode/schema';

/** Sentinel key for the fallback group: sessions whose `cwd` matches no registered workspace. */
export const UNREGISTERED_THREAD_GROUP_KEY = 'unregistered';

/**
 * Drop sessions an automation (loop/schedule) created — they are managed from the Automations
 * surface, not the Threads sidebar. The full list stays available for explicit by-id selection (an
 * automation's detail view can still open its run's conversation); only the sidebar and landing
 * fallbacks filter through this.
 */
export function withoutAutomationSessions(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => session.automation === undefined);
}

/** Sentinel key for the synthetic pinned group — see {@link extractPinnedGroup}. */
export const PINNED_THREAD_GROUP_KEY = 'pinned';

export interface ThreadGroup {
  key: string;
  /** The identity per-group UI state (collapse) persists against: {@link normalizeCwdKey}'d
   * `workspace.cwd` or {@link UNREGISTERED_THREAD_GROUP_KEY} — stable across an
   * archive/re-register cycle, unlike `key` (`workspace.workspaceId`). */
  collapseKey: string;
  /** The workspace this group belongs to; `null` for the unregistered fallback group. */
  workspace: WorkspaceRecord | null;
  sessions: SessionInfo[];
  /** True for the daemon-owned chat workspace's group — rendered as the flat "Chats" section
   * instead of a collapsible Projects group. */
  isChat: boolean;
  /** True for the synthetic pinned group (see {@link extractPinnedGroup}) — rendered as the
   * top-level "Pinned" section instead of a Projects group. */
  isPinned: boolean;
}

/**
 * Groups sessions by the workspace whose `cwd` matches (via `normalizeCwdKey`): groups order by
 * `lastUsedAt` desc, sessions by `createdAt` desc, unmatched sessions in one fallback group, last.
 * Project/chat workspaces produce groups even with zero sessions; worktree sessions join their
 * parent project and never produce a top-level group. The chat workspace's group is marked
 * `isChat`; callers split it out into the "Chats" section.
 */
export function groupThreadsByWorkspace(
  sessions: readonly SessionInfo[],
  workspaces: readonly WorkspaceRecord[],
): ThreadGroup[] {
  const workspaceByCwdKey = new Map(
    workspaces.map((workspace) => [normalizeCwdKey(workspace.cwd), workspace]),
  );
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace]));
  const sessionsByWorkspaceId = new Map<string, SessionInfo[]>();
  const unregistered: SessionInfo[] = [];

  for (let i = 0, len = sessions.length; i < len; i++) {
    const session = sessions[i];
    const matched = workspaceByCwdKey.get(normalizeCwdKey(session.cwd));
    let workspace = matched;
    if (matched && workspaceKind(matched) === 'worktree') {
      const parent =
        matched.parentWorkspaceId === undefined
          ? undefined
          : workspaceById.get(matched.parentWorkspaceId);
      workspace = parent && workspaceKind(parent) === 'project' ? parent : undefined;
    }
    if (!workspace) {
      unregistered.push(session);
      continue;
    }
    const bucket = sessionsByWorkspaceId.get(workspace.workspaceId);
    if (bucket) bucket.push(session);
    else sessionsByWorkspaceId.set(workspace.workspaceId, [session]);
  }

  const groups: ThreadGroup[] = workspaces
    .filter((workspace) => workspaceKind(workspace) !== 'worktree')
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map((workspace) => ({
      key: workspace.workspaceId,
      collapseKey: normalizeCwdKey(workspace.cwd),
      workspace,
      sessions: sortByCreatedAtDescending(sessionsByWorkspaceId.get(workspace.workspaceId) ?? []),
      isChat: workspaceKind(workspace) === 'chat',
      isPinned: false,
    }));

  if (unregistered.length > 0) {
    groups.push({
      key: UNREGISTERED_THREAD_GROUP_KEY,
      collapseKey: UNREGISTERED_THREAD_GROUP_KEY,
      workspace: null,
      sessions: sortByCreatedAtDescending(unregistered),
      isChat: false,
      isPinned: false,
    });
  }

  return groups;
}

/**
 * Splits pinned sessions into the synthetic "Pinned" group, ordered by `pinnedIds` (pin recency —
 * the pin store prepends). Ids matching no session are ignored; `pinnedGroup` is `null` when none
 * match. Callers group `rest` by workspace, so pinned sessions never appear in their original group.
 */
export function extractPinnedGroup(
  sessions: readonly SessionInfo[],
  pinnedIds: readonly SessionId[],
): { pinnedGroup: ThreadGroup | null; rest: SessionInfo[] } {
  const pinned = new Set(pinnedIds);
  const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
  const pinnedSessions = pinnedIds.flatMap((id) => sessionById.get(id) ?? []);
  if (pinnedSessions.length === 0) return { pinnedGroup: null, rest: [...sessions] };
  return {
    pinnedGroup: {
      key: PINNED_THREAD_GROUP_KEY,
      collapseKey: PINNED_THREAD_GROUP_KEY,
      workspace: null,
      sessions: pinnedSessions,
      isChat: false,
      isPinned: true,
    },
    rest: sessions.filter((session) => !pinned.has(session.sessionId)),
  };
}

function sortByCreatedAtDescending(sessions: readonly SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => b.createdAt - a.createdAt);
}
