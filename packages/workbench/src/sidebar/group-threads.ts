import type { SessionInfo, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey } from '@linkcode/schema';

/** Sentinel key for the fallback group: sessions whose `cwd` matches no registered workspace. */
export const UNREGISTERED_THREAD_GROUP_KEY = 'unregistered';

export interface ThreadGroup {
  key: string;
  /** The workspace this group belongs to; `null` for the unregistered fallback group. */
  workspace: WorkspaceRecord | null;
  sessions: SessionInfo[];
}

/**
 * Groups sessions by the workspace whose `cwd` matches (via `normalizeCwdKey`). Groups are
 * ordered by `workspace.lastUsedAt` descending; sessions within a group are ordered by
 * `createdAt` descending. Sessions matching no workspace land in one fallback group, always last.
 * A registered workspace with no sessions produces no group — there is nothing to list.
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

  const groups: ThreadGroup[] = workspaces
    .filter((workspace) => sessionsByWorkspaceId.has(workspace.workspaceId))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map((workspace) => ({
      key: workspace.workspaceId,
      workspace,
      sessions: sortByCreatedAtDescending(sessionsByWorkspaceId.get(workspace.workspaceId) ?? []),
    }));

  if (unregistered.length > 0) {
    groups.push({
      key: UNREGISTERED_THREAD_GROUP_KEY,
      workspace: null,
      sessions: sortByCreatedAtDescending(unregistered),
    });
  }

  return groups;
}

function sortByCreatedAtDescending(sessions: readonly SessionInfo[]): SessionInfo[] {
  return [...sessions].sort((a, b) => b.createdAt - a.createdAt);
}
