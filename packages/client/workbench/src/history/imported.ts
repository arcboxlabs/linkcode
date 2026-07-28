import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';

/** Dedup key — provider history ids are only unique within one agent kind. */
export function importedSessionKey(kind: AgentKind, historyId: string): string {
  return `${kind}:${historyId}`;
}

/**
 * Maps every provider history id in the session list to its session, so a history browser marks
 * entries as imported instead of minting duplicates. A cold import carries the id only on
 * `origin`; a session that has run carries the latest run's id on `historyId` — check both.
 */
export function importedSessionByHistoryId(
  sessions: readonly SessionInfo[],
): Map<string, SessionId> {
  const map = new Map<string, SessionId>();
  for (const session of sessions) {
    if (session.historyId !== undefined) {
      map.set(importedSessionKey(session.kind, session.historyId), session.sessionId);
    }
    if (session.origin?.type === 'imported') {
      const key = importedSessionKey(session.kind, session.origin.historyId);
      if (!map.has(key)) map.set(key, session.sessionId);
    }
  }
  return map;
}
