import type { AgentHistoryId, AgentKind } from '@linkcode/schema';
import { isRecord } from './history-util';

interface HistoryBranchCursorPayload {
  version: 1;
  kind: AgentKind;
  historyId: AgentHistoryId;
  branchPoint: string | null;
}

export function encodeHistoryBranchCursor(
  kind: AgentKind,
  historyId: AgentHistoryId,
  branchPoint: string | null,
): string {
  return JSON.stringify({
    version: 1,
    kind,
    historyId,
    branchPoint,
  } satisfies HistoryBranchCursorPayload);
}

export function decodeHistoryBranchCursor(
  cursor: string,
  kind: AgentKind,
  historyId: AgentHistoryId,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    throw new Error(`${kind}: invalid history branch cursor`);
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.kind !== kind ||
    parsed.historyId !== historyId ||
    (parsed.branchPoint !== null && typeof parsed.branchPoint !== 'string')
  ) {
    throw new Error(`${kind}: history branch cursor does not match the source session`);
  }
  return parsed.branchPoint;
}
