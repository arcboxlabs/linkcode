import type { ConversationGraphSnapshot } from '@linkcode/client-core';
import type { ConversationGraphTurn, SessionId, TurnId } from '@linkcode/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLineageStore } from '../lineage-store';

const sessionId = 'sess-1' as SessionId;

function turn(id: string, parent: string | null): ConversationGraphTurn {
  return {
    turnId: id as TurnId,
    sessionId,
    parentTurnId: parent as TurnId | null,
    siblingOrdinal: 1,
    input: { type: 'shell-command', command: id },
    runId: `run-${id}` as ConversationGraphTurn['runId'],
    state: 'completed',
    createdAt: 1,
  };
}

function snapshot(activeLeaf: string, turns: ConversationGraphTurn[]): ConversationGraphSnapshot {
  return { sessionId, graphRevision: 9, activeLeafTurnId: activeLeaf as TurnId, turns };
}

beforeEach(() => {
  useLineageStore.setState({ parkedBySession: {}, preferredChildBySession: {} });
});

describe('lineage store', () => {
  it('parks against the host default, dismisses the elsewhere chip per default, and follows again', () => {
    const store = useLineageStore.getState();
    store.park(sessionId, 'B1' as TurnId, 'B2' as TurnId);
    expect(useLineageStore.getState().parkedBySession[sessionId]).toEqual({
      leafTurnId: 'B1',
      sinceLeafTurnId: 'B2',
      dismissedLeafTurnId: undefined,
    });
    store.dismissElsewhere(sessionId, 'C2' as TurnId);
    expect(useLineageStore.getState().parkedBySession[sessionId]?.dismissedLeafTurnId).toBe('C2');
    store.follow(sessionId);
    expect(useLineageStore.getState().parkedBySession[sessionId]).toBeUndefined();
  });

  it('releases a parked view once the host default runs through its leaf', () => {
    const store = useLineageStore.getState();
    store.park(sessionId, 'B1' as TurnId, 'B2' as TurnId);
    // The active lineage moved to a sibling: still parked.
    store.noteGraph(snapshot('B2', [turn('A', null), turn('B1', 'A'), turn('B2', 'A')]));
    expect(useLineageStore.getState().parkedBySession[sessionId]?.leafTurnId).toBe('B1');
    // A continue from the parked version: its lineage is the active one again.
    store.noteGraph(
      snapshot('C1', [turn('A', null), turn('B1', 'A'), turn('B2', 'A'), turn('C1', 'B1')]),
    );
    expect(useLineageStore.getState().parkedBySession[sessionId]).toBeUndefined();
  });

  it('remembers the chosen child per parent and session', () => {
    useLineageStore.getState().rememberChild(sessionId, 'A', 'B1' as TurnId);
    useLineageStore.getState().rememberChild(sessionId, 'root', 'A' as TurnId);
    expect(useLineageStore.getState().preferredChildBySession[sessionId]).toEqual({
      A: 'B1',
      root: 'A',
    });
  });
});
