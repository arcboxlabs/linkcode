import type { ConversationGraphSnapshot } from '@linkcode/client-core';
import type { SessionId, TurnId } from '@linkcode/schema';
import { create } from 'zustand';
import { lineageIncludes, turnsById } from './lineage';

/** A client browsing a version other than the host default. */
export interface ParkedLineage {
  /** The leaf the timeline reads toward. */
  leafTurnId: TurnId;
  /** The host default when the viewer parked; a different one means the conversation moved on
   * elsewhere while this viewer stayed — a failed attempt or a settle, which only bump the
   * revision, is nobody's news. */
  sinceLeafTurnId: TurnId | undefined;
  /** The host default whose "continued elsewhere" chip the viewer dismissed. */
  dismissedLeafTurnId: TurnId | undefined;
}

interface LineageState {
  parkedBySession: Record<string, ParkedLineage>;
  /** Remembered descent per parent (`lineageParentKey`): `‹ ›` returns to the version last viewed. */
  preferredChildBySession: Record<string, Record<string, TurnId>>;
  park: (sessionId: SessionId, leafTurnId: TurnId, activeLeafTurnId: TurnId | undefined) => void;
  /** Back to the host default: the active lineage, following it live. */
  follow: (sessionId: SessionId) => void;
  rememberChild: (sessionId: SessionId, parentKey: string, childTurnId: TurnId) => void;
  dismissElsewhere: (sessionId: SessionId, activeLeafTurnId: TurnId | undefined) => void;
  /** A fresh graph snapshot: once the host default runs through the parked leaf — the viewer's
   * own edit or continue landed, or a plain send extended the version it was on — the view is at
   * that lineage's tip again and follows. */
  noteGraph: (snapshot: ConversationGraphSnapshot) => void;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * Client-local view position per session (`viewLeafTurnId` in the design): switching versions is
 * a pure read that never touches the daemon's `activeLeafTurnId`. Not persisted — a reopened
 * thread starts at the host default.
 */
export const useLineageStore = create<LineageState>()((set) => ({
  parkedBySession: {},
  preferredChildBySession: {},
  park: (sessionId, leafTurnId, activeLeafTurnId) =>
    set((state) => ({
      parkedBySession: {
        ...state.parkedBySession,
        [sessionId]: {
          leafTurnId,
          sinceLeafTurnId: activeLeafTurnId,
          dismissedLeafTurnId: undefined,
        },
      },
    })),
  follow: (sessionId) =>
    set((state) =>
      sessionId in state.parkedBySession
        ? { parkedBySession: without(state.parkedBySession, sessionId) }
        : state,
    ),
  rememberChild: (sessionId, parentKey, childTurnId) =>
    set((state) => ({
      preferredChildBySession: {
        ...state.preferredChildBySession,
        [sessionId]: { ...state.preferredChildBySession[sessionId], [parentKey]: childTurnId },
      },
    })),
  dismissElsewhere: (sessionId, activeLeafTurnId) =>
    set((state) => {
      const parked = state.parkedBySession[sessionId];
      if (parked === undefined) return state;
      return {
        parkedBySession: {
          ...state.parkedBySession,
          [sessionId]: { ...parked, dismissedLeafTurnId: activeLeafTurnId },
        },
      };
    }),
  noteGraph: (snapshot) =>
    set((state) => {
      const parked = state.parkedBySession[snapshot.sessionId];
      if (parked === undefined) return state;
      const caughtUp = lineageIncludes(
        turnsById(snapshot.turns),
        snapshot.activeLeafTurnId,
        parked.leafTurnId,
      );
      return caughtUp
        ? { parkedBySession: without(state.parkedBySession, snapshot.sessionId) }
        : state;
    }),
}));
