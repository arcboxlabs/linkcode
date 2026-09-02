import type { AgentHistoryEvent, ConversationTurn, TurnId } from '@linkcode/schema';
import { RequestError } from '../failure';
import { promptContentFingerprint } from '../session/live-session';

export interface ProviderPartition {
  readonly userRow: AgentHistoryEvent;
  readonly rest: AgentHistoryEvent[];
}

export interface CorpusAttribution {
  /** Partition i is the i-th settled path turn's provider content; a prefix of the candidates. */
  readonly attributed: ProviderPartition[];
  readonly leading: AgentHistoryEvent[];
  /** The in-flight turn's own user row, when a trailing extra partition fingerprint-verified as it. */
  readonly trailingLive?: AgentHistoryEvent;
}

/** Root→leaf path through `parentTurnId`; a broken chain fails loud rather than rendering wrong. */
export function pathToLeaf(
  byId: Map<TurnId, ConversationTurn>,
  leafTurnId: TurnId | undefined,
): ConversationTurn[] {
  if (leafTurnId === undefined) return [];
  const path: ConversationTurn[] = [];
  const seen = new Set<TurnId>();
  let currentId: TurnId | null = leafTurnId;
  while (currentId !== null) {
    if (seen.has(currentId)) {
      throw new RequestError({ code: 'conflict', message: 'The turn graph contains a cycle' });
    }
    seen.add(currentId);
    const turn = byId.get(currentId);
    if (!turn) {
      throw new RequestError({ code: 'conflict', message: `Missing turn in path: ${currentId}` });
    }
    path.push(turn);
    currentId = turn.parentTurnId;
  }
  return path.reverse();
}

/**
 * The attribution gate (§9 discipline): positions attribute only while each partition's user row
 * fingerprint-matches the host prompt at that position; the FIRST mismatch degrades that turn and
 * every later one to placeholders — alignment is lost past a mismatch, never resynced positionally.
 * One trailing extra partition is tolerated only when it fingerprint-verifies as the in-flight
 * turn's own row (the live tail owns it); any other count anomaly attributes nothing.
 */
export function attributeCorpus(
  corpus: readonly AgentHistoryEvent[],
  hostFingerprints: ReadonlyArray<string | undefined>,
  liveFingerprint: string | undefined,
): CorpusAttribution {
  const none = { attributed: [], leading: [] };
  const split = partitionAtUserRows(corpus);
  let candidates = split.partitions;
  let trailingLive: AgentHistoryEvent | undefined;
  const trailing = candidates.at(-1);
  if (trailing !== undefined && candidates.length === hostFingerprints.length + 1) {
    if (liveFingerprint === undefined || userRowFingerprint(trailing.userRow) !== liveFingerprint) {
      return none;
    }
    trailingLive = trailing.userRow;
    candidates = candidates.slice(0, -1);
  }
  if (candidates.length !== hostFingerprints.length) return none;
  const attributed: ProviderPartition[] = [];
  for (let i = 0, len = candidates.length; i < len; i++) {
    const hostFingerprint = hostFingerprints[i];
    if (
      hostFingerprint === undefined ||
      userRowFingerprint(candidates[i].userRow) !== hostFingerprint
    ) {
      break;
    }
    attributed.push(candidates[i]);
  }
  if (attributed.length === 0) return none;
  return {
    attributed,
    leading: split.leading,
    // The live row is the successor of the LAST settled turn only when every position verified.
    ...(attributed.length === candidates.length && trailingLive !== undefined && { trailingLive }),
  };
}

function userRowFingerprint(entry: AgentHistoryEvent): string | undefined {
  return entry.event.type === 'user-message'
    ? promptContentFingerprint(entry.event.content)
    : undefined;
}

/** Splits a provider corpus at its user rows: partition i is user row i plus what follows it. */
function partitionAtUserRows(corpus: readonly AgentHistoryEvent[]): {
  leading: AgentHistoryEvent[];
  partitions: ProviderPartition[];
} {
  const leading: AgentHistoryEvent[] = [];
  const partitions: ProviderPartition[] = [];
  for (let i = 0, len = corpus.length; i < len; i++) {
    const entry = corpus[i];
    if (entry.event.type === 'user-message') {
      partitions.push({ userRow: entry, rest: [] });
    } else {
      const current = partitions.at(-1);
      if (current === undefined) leading.push(entry);
      else current.rest.push(entry);
    }
  }
  return { leading, partitions };
}
