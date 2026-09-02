import type { AgentHistoryEvent, ConversationTurn, SessionRecord, TurnId } from '@linkcode/schema';
import { RequestError } from '../failure';
import { promptContentFingerprint } from '../session/live-session';

export interface ProviderPartition {
  readonly userRow: AgentHistoryEvent;
  readonly rest: AgentHistoryEvent[];
}

export interface CorpusAttribution {
  /** Partition i is the i-th settled path turn's provider content: a prefix of the candidates, or
   * all of them when the corpus tail was aligned behind hidden pre-graph history. */
  readonly attributed: ProviderPartition[];
  /** Rows before the first attributed partition — those ahead of the first user row, plus the
   * hidden history's own partitions — rendered unattributed, as a cold read would. */
  readonly leading: AgentHistoryEvent[];
  /** The in-flight turn's own user row, when a trailing extra partition fingerprint-verified as it. */
  readonly trailingLive?: AgentHistoryEvent;
}

/** Whether provider rows can precede the lineage's root turn: an imported transcript, or a created
 * session whose earlier runs wrote provider history before the root was recorded (a session older
 * than its turn rows). A run that died before its first prompt left nothing behind. */
export function hasHiddenPrefix(record: SessionRecord, root: ConversationTurn): boolean {
  if (record.origin.type !== 'created') return true;
  const index = record.runs.findIndex((run) => run.runId === root.runId);
  // A root whose run cannot be placed (a pre-runId record) takes the safe direction.
  if (index < 0) return true;
  return record.runs.slice(0, index).some((run) => run.historyId !== undefined);
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
 * fingerprint-matches the host prompt at that position — fingerprints verify an alignment, they
 * never search for one. With as many partitions as settled host turns the alignment is anchored at
 * the START and the FIRST mismatch degrades that turn and every later one to placeholders, never
 * resynced positionally. With MORE partitions — allowed only where hidden pre-graph history can
 * exist — the host turns align to the LAST partitions, every position must verify, and no other
 * offset may verify in full (repeated prompts let a shifted alignment verify too), else nothing
 * attributes; the unmatched head is hidden history. One trailing extra partition is tolerated only
 * when it fingerprint-verifies as the in-flight turn's own row (the live tail owns it).
 */
export function attributeCorpus(
  corpus: readonly AgentHistoryEvent[],
  hostFingerprints: ReadonlyArray<string | undefined>,
  liveFingerprint: string | undefined,
  hiddenPrefixAllowed = false,
): CorpusAttribution {
  const none = { attributed: [], leading: [] };
  const split = partitionAtUserRows(corpus);
  const { partitions } = split;
  let candidates = partitions;
  let trailingLive: AgentHistoryEvent | undefined;
  const trailing = partitions.at(-1);
  if (
    trailing !== undefined &&
    liveFingerprint !== undefined &&
    partitions.length > hostFingerprints.length &&
    userRowFingerprint(trailing.userRow) === liveFingerprint
  ) {
    trailingLive = trailing.userRow;
    candidates = partitions.slice(0, -1);
  }
  const hidden = candidates.length - hostFingerprints.length;
  if (hidden < 0 || (!hiddenPrefixAllowed && hidden > 0)) return none;
  const aligned = candidates.slice(hidden);
  const attributed: ProviderPartition[] = [];
  for (let i = 0, len = aligned.length; i < len; i++) {
    if (!positionVerifies(aligned[i], hostFingerprints[i])) break;
    attributed.push(aligned[i]);
  }
  if (attributed.length === 0) return none;
  // Anchored at the end (hidden rows ahead, or the live row peeled where hidden rows may exist),
  // one mismatch leaves the whole alignment unproven — and so does any other offset that verifies
  // in full: the replay binding a wrong alignment backfills is never corrected.
  if (hiddenPrefixAllowed && (trailingLive !== undefined || hidden > 0)) {
    if (attributed.length !== aligned.length) return none;
    for (let k = 0, last = partitions.length - hostFingerprints.length; k <= last; k++) {
      if (k !== hidden && windowVerifies(partitions, k, hostFingerprints)) return none;
    }
  }
  const leading = [...split.leading];
  for (let i = 0; i < hidden; i++) {
    const partition = candidates[i];
    leading.push(partition.userRow);
    for (let j = 0, len = partition.rest.length; j < len; j++) leading.push(partition.rest[j]);
  }
  return {
    attributed,
    leading,
    // The live row is the successor of the LAST settled turn only when every position verified.
    ...(attributed.length === aligned.length && trailingLive !== undefined && { trailingLive }),
  };
}

function userRowFingerprint(entry: AgentHistoryEvent): string | undefined {
  return entry.event.type === 'user-message'
    ? promptContentFingerprint(entry.event.content)
    : undefined;
}

function positionVerifies(
  partition: ProviderPartition,
  hostFingerprint: string | undefined,
): boolean {
  return hostFingerprint !== undefined && userRowFingerprint(partition.userRow) === hostFingerprint;
}

/** Whether the host turns verify against the partitions starting at `offset`, every position. */
function windowVerifies(
  partitions: readonly ProviderPartition[],
  offset: number,
  hostFingerprints: ReadonlyArray<string | undefined>,
): boolean {
  for (let i = 0, len = hostFingerprints.length; i < len; i++) {
    if (!positionVerifies(partitions[offset + i], hostFingerprints[i])) return false;
  }
  return true;
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
