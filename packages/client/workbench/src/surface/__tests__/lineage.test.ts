import type { ConversationGraphSnapshot } from '@linkcode/client-core';
import type { ConversationGraphTurn, SessionId, TurnId } from '@linkcode/schema';
import { userRowMessageId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  continuationParent,
  descendToLeaf,
  lineageIncludes,
  lineageParentKey,
  lineagePath,
  lineageVersions,
  onActiveLineage,
  siblingsOf,
  timelineLeftActiveLineage,
  turnsById,
} from '../lineage';

const sessionId = 'sess-1' as SessionId;

function turn(
  id: string,
  parent: string | null,
  ordinal: number,
  createdAt: number,
  state: ConversationGraphTurn['state'] = 'completed',
): ConversationGraphTurn {
  return {
    turnId: id as TurnId,
    sessionId,
    parentTurnId: parent as TurnId | null,
    siblingOrdinal: ordinal,
    input: { type: 'shell-command', command: id },
    runId: `run-${id}` as ConversationGraphTurn['runId'],
    state,
    createdAt,
  };
}

//        A
//      /   \
//     B1    B2 (edited B)
//     |     |  \
//     C1    C2  C3 (edited C2, failed)
const TURNS = [
  turn('A', null, 1, 1),
  turn('B1', 'A', 1, 2),
  turn('B2', 'A', 2, 5),
  turn('C1', 'B1', 1, 3),
  turn('C2', 'B2', 1, 6),
  turn('C3', 'B2', 2, 7, 'failed'),
];

describe('lineage helpers', () => {
  it('walks root to leaf and stops at a broken link', () => {
    const byId = turnsById(TURNS);
    expect(lineagePath(byId, 'C3' as TurnId).map((t) => t.turnId)).toEqual(['A', 'B2', 'C3']);
    expect(lineagePath(byId, 'nope' as TurnId)).toEqual([]);
    expect(lineageIncludes(byId, 'C3' as TurnId, 'B2' as TurnId)).toBe(true);
    expect(lineageIncludes(byId, 'C3' as TurnId, 'B1' as TurnId)).toBe(false);
    expect(lineageIncludes(byId, undefined, 'A' as TurnId)).toBe(false);
  });

  it('orders siblings by ordinal and reports each path turn’s version', () => {
    expect(siblingsOf(TURNS, TURNS[2]).map((t) => t.turnId)).toEqual(['B1', 'B2']);
    const versions = lineageVersions(TURNS, lineagePath(turnsById(TURNS), 'C3' as TurnId));
    expect(versions.get(userRowMessageId('A' as TurnId))).toEqual({
      index: 1,
      count: 1,
      state: null,
    });
    expect(versions.get(userRowMessageId('B2' as TurnId))).toEqual({
      index: 2,
      count: 2,
      state: null,
    });
    expect(versions.get(userRowMessageId('C3' as TurnId))).toEqual({
      index: 2,
      count: 2,
      state: 'failed',
    });
  });

  it('descends to the newest child unless a version was remembered', () => {
    expect(descendToLeaf(TURNS, 'A' as TurnId, {})).toBe('C3');
    expect(descendToLeaf(TURNS, 'B1' as TurnId, {})).toBe('C1');
    const remembered = {
      [lineageParentKey('A' as TurnId)]: 'B1' as TurnId,
      [lineageParentKey('B2' as TurnId)]: 'C2' as TurnId,
    };
    expect(descendToLeaf(TURNS, 'A' as TurnId, remembered)).toBe('C1');
    expect(descendToLeaf(TURNS, 'B2' as TurnId, remembered)).toBe('C2');
    // A remembered child that no longer exists falls back to the newest.
    expect(descendToLeaf(TURNS, 'B2' as TurnId, { B2: 'gone' as TurnId })).toBe('C3');
  });

  it('continues from a version’s last completed turn, never from a failed tip', () => {
    const byId = turnsById(TURNS);
    expect(continuationParent(byId, 'C3' as TurnId)).toBe('B2');
    expect(continuationParent(byId, 'C1' as TurnId)).toBe('C1');
    const failedRoot = turnsById([turn('F', null, 1, 1, 'failed')]);
    expect(continuationParent(failedRoot, 'F' as TurnId)).toBeNull();
  });

  it('places a read on the active lineage unless it is of another version', () => {
    const graph = (activeLeaf: string): ConversationGraphSnapshot => ({
      sessionId,
      graphRevision: 1,
      activeLeafTurnId: activeLeaf as TurnId,
      turns: TURNS,
    });
    expect(onActiveLineage('C2' as TurnId, graph('C2'))).toBe(true);
    // Behind the default on its own lineage: a continuation folds onto it.
    expect(onActiveLineage('B2' as TurnId, graph('C2'))).toBe(true);
    // Another version.
    expect(onActiveLineage('C1' as TurnId, graph('C2'))).toBe(false);
    // Ahead of a stale snapshot, or not placed by it yet.
    expect(onActiveLineage('C2' as TurnId, graph('B2'))).toBe(true);
    expect(onActiveLineage('new' as TurnId, graph('C2'))).toBe(true);
    // Nothing to judge against without a leaf or a tree.
    expect(onActiveLineage(undefined, graph('C2'))).toBe(true);
    expect(onActiveLineage('C1' as TurnId, undefined)).toBe(true);
  });

  it('notices a timeline showing a turn off the active lineage', () => {
    const graph = (activeLeaf: string): ConversationGraphSnapshot => ({
      sessionId,
      graphRevision: 1,
      activeLeafTurnId: activeLeaf as TurnId,
      turns: TURNS,
    });
    const rows = (...ids: string[]) => ids.map((id) => userRowMessageId(id as TurnId));
    // Following B1's lineage when the default moved to B2's: B1 and C1 are off it.
    expect(timelineLeftActiveLineage(rows('A', 'B1', 'C1'), graph('C2'))).toBe(true);
    // The edit's own echo folded onto the old lineage, then the tree caught up.
    expect(timelineLeftActiveLineage(rows('A', 'B1', 'B2'), graph('B2'))).toBe(true);
    expect(timelineLeftActiveLineage(rows('A', 'B2', 'C2'), graph('C2'))).toBe(false);
    // A row the tree does not know yet is a fresher echo, not a foreign version.
    expect(timelineLeftActiveLineage(rows('A', 'B2', 'C2', 'new'), graph('C2'))).toBe(false);
  });
});
