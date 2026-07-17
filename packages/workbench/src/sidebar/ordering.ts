import type { SessionId, SessionInfo } from '@linkcode/schema';
import type { ThreadGroup } from './group-threads';

/**
 * Applies the manual sidebar order to project groups: groups listed in `orderedKeys` first, in
 * that order; unlisted ones (registered after the last drag) follow in their incoming order. The
 * chat and unregistered fallback groups are not sortable — re-appended after the project groups.
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
 * Orders a group's sessions: pinned segment first, then unpinned. Within each segment, sessions
 * not yet in `manualIds` come first in incoming order (most recent first — inbox semantics),
 * followed by the manually ordered ones. Ids matching no session are ignored.
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
 * The group's next manual order after dropping `activeId` relative to `overId`. The drop position
 * is clamped to the dragged thread's own segment — pin membership only changes through the
 * explicit pin button, never as a drag side effect. Returns `null` on a self-drop or unknown id.
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
