import type { SessionId, SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from './group-threads';

/**
 * Applies the manual sidebar order to project groups. Groups whose `collapseKey` appears in
 * `orderedKeys` come first, in that order; groups not yet listed (workspaces registered after the
 * last drag) follow in their incoming order (`lastUsedAt` descending). The chat group and the
 * unregistered fallback group are not sortable: they are re-appended after the project groups,
 * matching where the sidebar renders them (Chats is extracted into its own section; the fallback
 * group always renders last).
 */
export function orderGroups(
  groups: readonly ThreadGroup[],
  orderedKeys: readonly string[],
): ThreadGroup[] {
  const rank = new Map(orderedKeys.map((key, index) => [key, index]));
  const listed: ThreadGroup[] = [];
  const unlisted: ThreadGroup[] = [];
  const fixed: ThreadGroup[] = [];

  for (const group of groups) {
    if (group.isChat || group.workspace === null) fixed.push(group);
    else if (rank.has(group.collapseKey)) listed.push(group);
    else unlisted.push(group);
  }

  listed.sort((a, b) => (rank.get(a.collapseKey) ?? 0) - (rank.get(b.collapseKey) ?? 0));
  return [...listed, ...unlisted, ...fixed];
}

/**
 * Orders a group's sessions for display: the pinned segment first, then the unpinned one. Within
 * each segment, sessions not yet in `manualIds` (threads created after the last drag) come first
 * in their incoming order (most recent first — inbox semantics), followed by the manually ordered
 * ones. Ids in `pinnedIds`/`manualIds` that match no session are ignored.
 */
export function orderThreads(
  sessions: readonly SessionInfo[],
  pinnedIds: readonly SessionId[],
  manualIds: readonly SessionId[],
): SessionInfo[] {
  const pinned = new Set(pinnedIds);
  const rank = new Map(manualIds.map((id, index) => [id, index]));
  const orderSegment = (segment: readonly SessionInfo[]): SessionInfo[] => {
    const unlisted = segment.filter((session) => !rank.has(session.sessionId));
    const listed = segment
      .filter((session) => rank.has(session.sessionId))
      .sort((a, b) => (rank.get(a.sessionId) ?? 0) - (rank.get(b.sessionId) ?? 0));
    return [...unlisted, ...listed];
  };
  return [
    ...orderSegment(sessions.filter((session) => pinned.has(session.sessionId))),
    ...orderSegment(sessions.filter((session) => !pinned.has(session.sessionId))),
  ];
}

export interface ThreadDragInput {
  /** The group's full display order (pinned segment first) — `orderThreads`' output ids. */
  orderedIds: readonly SessionId[];
  pinnedIds: readonly SessionId[];
  activeId: SessionId;
  overId: SessionId;
  placement: 'before' | 'after';
}

/**
 * Computes the group's next manual order after dropping `activeId` relative to `overId`. The drop
 * position is clamped to the dragged thread's own segment: a pinned thread cannot land below the
 * pinned segment, an unpinned one cannot land above it — pin membership only changes through the
 * explicit pin button, never as a drag side effect. Returns `null` when the drag is a no-op
 * (self-drop) or either id is not in the list.
 */
export function applyThreadDrag(input: ThreadDragInput): SessionId[] | null {
  const { orderedIds, pinnedIds, activeId, overId, placement } = input;
  if (activeId === overId) return null;
  if (!orderedIds.includes(activeId)) return null;

  const without = orderedIds.filter((id) => id !== activeId);
  const overIndex = without.indexOf(overId);
  if (overIndex < 0) return null;

  const pinned = new Set(pinnedIds);
  const pinnedCount = without.filter((id) => pinned.has(id)).length;
  const unclamped = placement === 'before' ? overIndex : overIndex + 1;
  const insertAt = pinned.has(activeId)
    ? Math.min(unclamped, pinnedCount)
    : Math.max(unclamped, pinnedCount);

  return [...without.slice(0, insertAt), activeId, ...without.slice(insertAt)];
}
