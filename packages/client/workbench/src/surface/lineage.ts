import type { ConversationGraphSnapshot } from '@linkcode/client-core';
import type { ConversationGraphTurn, TurnId } from '@linkcode/schema';
import { userRowMessageId } from '@linkcode/schema';
import type { TurnVersion } from '@linkcode/ui';

/** Key of the remembered-descent map: a root's parent is `null`. */
export function lineageParentKey(parentTurnId: TurnId | null): string {
  return parentTurnId ?? 'root';
}

export function turnsById(
  turns: readonly ConversationGraphTurn[],
): Map<TurnId, ConversationGraphTurn> {
  return new Map(turns.map((turn) => [turn.turnId, turn]));
}

/** Root→leaf through `parentTurnId`; a broken or cyclic chain ends the path rather than looping. */
export function lineagePath(
  byId: ReadonlyMap<TurnId, ConversationGraphTurn>,
  leafTurnId: TurnId | undefined,
): ConversationGraphTurn[] {
  const path: ConversationGraphTurn[] = [];
  const seen = new Set<TurnId>();
  let cursor = leafTurnId;
  while (cursor !== undefined && !seen.has(cursor)) {
    const turn = byId.get(cursor);
    if (turn === undefined) break;
    seen.add(cursor);
    path.push(turn);
    cursor = turn.parentTurnId ?? undefined;
  }
  return path.reverse();
}

/** Whether the lineage ending at `leafTurnId` passes through `turnId` (itself included). */
export function lineageIncludes(
  byId: ReadonlyMap<TurnId, ConversationGraphTurn>,
  leafTurnId: TurnId | undefined,
  turnId: TurnId,
): boolean {
  return lineagePath(byId, leafTurnId).some((turn) => turn.turnId === turnId);
}

/** Where a send from a view of `leafTurnId` lands: the lineage's last completed turn — a failed or
 * cancelled tip ran nothing to continue from, so the send is a sibling of it — else a new root. */
export function continuationParent(
  byId: ReadonlyMap<TurnId, ConversationGraphTurn>,
  leafTurnId: TurnId,
): TurnId | null {
  const path = lineagePath(byId, leafTurnId);
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].state === 'completed') return path[i].turnId;
  }
  return null;
}

/** Whether a read toward `leafTurnId` is on the active lineage as far as `graph` knows: on or
 * behind the host default, ahead of a stale snapshot, or not placed by it yet. Only a read of
 * another version is not — the live stream, which belongs to the active lineage's run, must not
 * fold into it. */
export function onActiveLineage(
  leafTurnId: TurnId | undefined,
  graph: ConversationGraphSnapshot | undefined,
): boolean {
  if (leafTurnId === undefined || graph?.activeLeafTurnId === undefined) return true;
  const byId = turnsById(graph.turns);
  if (!byId.has(leafTurnId)) return true;
  return (
    lineageIncludes(byId, graph.activeLeafTurnId, leafTurnId) ||
    lineageIncludes(byId, leafTurnId, graph.activeLeafTurnId)
  );
}

/** Whether a timeline shows a user row of a turn the active lineage does not run through: the host
 * default moved to another version while this view followed it (an edit from any device), so the
 * view must read toward the default. Rows the tree does not know yet — an echo fresher than the
 * snapshot — do not count. */
export function timelineLeftActiveLineage(
  userRowIds: readonly string[],
  graph: ConversationGraphSnapshot,
): boolean {
  const known = new Set<string>(graph.turns.map((turn) => userRowMessageId(turn.turnId)));
  const onPath = new Set<string>(
    lineagePath(turnsById(graph.turns), graph.activeLeafTurnId).map((turn) =>
      userRowMessageId(turn.turnId),
    ),
  );
  for (let i = 0, len = userRowIds.length; i < len; i++) {
    const id = userRowIds[i];
    if (known.has(id) && !onPath.has(id)) return true;
  }
  return false;
}

/** A turn's siblings in ordinal order, itself included. */
export function siblingsOf(
  turns: readonly ConversationGraphTurn[],
  turn: ConversationGraphTurn,
): ConversationGraphTurn[] {
  return turns
    .filter((candidate) => candidate.parentTurnId === turn.parentTurnId)
    .sort((a, b) => a.siblingOrdinal - b.siblingOrdinal);
}

function newestChild(children: readonly ConversationGraphTurn[]): ConversationGraphTurn {
  let newest = children[0];
  for (let i = 1, len = children.length; i < len; i++) {
    const child = children[i];
    if (
      child.createdAt > newest.createdAt ||
      (child.createdAt === newest.createdAt && child.siblingOrdinal > newest.siblingOrdinal)
    ) {
      newest = child;
    }
  }
  return newest;
}

/** Descend from a chosen turn to a leaf: the remembered child at each level, else the newest. */
export function descendToLeaf(
  turns: readonly ConversationGraphTurn[],
  from: TurnId,
  preferredChild: Readonly<Record<string, TurnId>>,
): TurnId {
  let cursor = from;
  // Bounded by the tree size so a malformed graph cannot spin.
  for (let depth = 0, len = turns.length; depth <= len; depth++) {
    const children = turns.filter((turn) => turn.parentTurnId === cursor);
    if (children.length === 0) break;
    const remembered = preferredChild[lineageParentKey(cursor)];
    const next = children.find((child) => child.turnId === remembered) ?? newestChild(children);
    cursor = next.turnId;
  }
  return cursor;
}

/** Each path turn's version among its siblings, keyed by its user row's message id. */
export function lineageVersions(
  turns: readonly ConversationGraphTurn[],
  path: readonly ConversationGraphTurn[],
): Map<string, TurnVersion> {
  const versions = new Map<string, TurnVersion>();
  for (let i = 0, len = path.length; i < len; i++) {
    const turn = path[i];
    const siblings = siblingsOf(turns, turn);
    versions.set(userRowMessageId(turn.turnId), {
      index: siblings.findIndex((sibling) => sibling.turnId === turn.turnId) + 1,
      count: siblings.length,
      state: turn.state === 'failed' || turn.state === 'cancelled' ? turn.state : null,
    });
  }
  return versions;
}
