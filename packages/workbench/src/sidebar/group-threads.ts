import type { SessionId, SessionInfo, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey, workspaceKind } from '@linkcode/schema';

/** Sentinel key for the fallback group: sessions whose `cwd` matches no registered workspace. */
export const UNREGISTERED_THREAD_GROUP_KEY = 'unregistered';

/** Sentinel key for the synthetic pinned group — see {@link extractPinnedGroup}. */
export const PINNED_THREAD_GROUP_KEY = 'pinned';

export interface ThreadGroup {
  key: string;
  /**
   * The identity the sidebar persists per-group UI state (collapse) against —
   * {@link normalizeCwdKey}'d `workspace.cwd`, or {@link UNREGISTERED_THREAD_GROUP_KEY}. Stable
   * across an archive/re-register cycle, unlike `key` (`workspace.workspaceId`), which isn't.
   */
  collapseKey: string;
  /** The workspace this group belongs to; `null` for the unregistered fallback group. */
  workspace: WorkspaceRecord | null;
  sessions: SessionInfo[];
  /**
   * True for the daemon-owned chat workspace's group — the sidebar renders it as the flat
   * "Chats" section instead of a collapsible Projects group.
   */
  isChat: boolean;
  /**
   * True for the synthetic pinned group (see {@link extractPinnedGroup}) — the sidebar renders it
   * as the top-level "Pinned" section instead of a Projects group.
   */
  isPinned: boolean;
}

/**
 * Groups sessions by the workspace whose `cwd` matches (via `normalizeCwdKey`). Groups are
 * ordered by `workspace.lastUsedAt` descending; sessions within a group are ordered by
 * `createdAt` descending. Sessions matching no workspace land in one fallback group, always last.
 * Every registered workspace produces a group, even with zero sessions — the flattened sidebar
 * renders one group per workspace, and an empty one still needs a header to rename/archive/start a
 * thread in. The chat workspace's group (see `workspaceKind`) is marked `isChat`; callers split it
 * out into the sidebar's "Chats" section instead of rendering it among the Projects groups.
 */
export function groupThreadsByWorkspace(
  sessions: readonly SessionInfo[],
  workspaces: readonly WorkspaceRecord[],
): ThreadGroup[] {
  const workspaceByCwdKey = new Map(
    workspaces.map((workspace) => [normalizeCwdKey(workspace.cwd), workspace]),
  );
  const sessionsByWorkspaceId = new Map<string, SessionInfo[]>();
  const unregistered: SessionInfo[] = [];

  for (const session of sessions) {
    const workspace = workspaceByCwdKey.get(normalizeCwdKey(session.cwd));
    if (!workspace) {
      unregistered.push(session);
      continue;
    }
    const bucket = sessionsByWorkspaceId.get(workspace.workspaceId);
    if (bucket) bucket.push(session);
    else sessionsByWorkspaceId.set(workspace.workspaceId, [session]);
  }

  const groups: ThreadGroup[] = [...workspaces]
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
 * Splits the pinned sessions out into the synthetic "Pinned" group, ordered by `pinnedIds` (pin
 * recency — the pin store prepends). Pinned ids matching no session are ignored; `pinnedGroup` is
 * `null` when none match. `rest` (everything unpinned, incoming order) is what callers group by
 * workspace, so pinned sessions never appear in their original group.
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
