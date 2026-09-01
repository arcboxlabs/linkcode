import type { AgentHistoryId, AgentKind } from '@linkcode/schema';
import { isRecord } from './history-util';

interface HistoryBranchCursorPayload {
  version: 1;
  kind: AgentKind;
  historyId: AgentHistoryId;
  branchPoint: string | null;
}

/** A provider fork point minted by a live adapter; never crosses the wire. `cursor` is what
 * `branchHistory` accepts and forks the history right after the described turn. */
export interface HistoryCheckpoint {
  readonly historyId: AgentHistoryId;
  readonly cursor: string;
  /** `ending`: the turn settling now (emitted before its stop/idle). `preceding`: the turn before
   * the one whose dispatch just revealed the cut — opencode's cut is the successor's message id. */
  readonly turn: 'ending' | 'preceding';
}

/** A fork was refused because its checkpoint no longer names a live provider position (deleted or
 * rewritten history, an unforkable rollout). Nothing was created; the engine maps it to a typed
 * `unsupported` instead of ever aiming a fork at a guessed cut. */
export class HistoryCheckpointInvalidError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HistoryCheckpointInvalidError';
  }
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
