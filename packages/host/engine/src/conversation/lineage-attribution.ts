import type { AgentHistoryEvent, ConversationTurn, SessionRecord, TurnId } from '@linkcode/schema';
import { RequestError } from '../failure';
import { promptContentFingerprint } from '../session/live-session';
import { TERMINAL_TURN_STATES } from './turn-service';

export interface ProviderPartition {
  readonly userRow: AgentHistoryEvent;
  readonly rest: AgentHistoryEvent[];
}

/** One settled path turn's prompt fingerprint. A failed turn may or may not have left provider rows
 * (the prompt is persisted before generation, so a mid-run failure usually did; a refusal before
 * dispatch did not), so its partition is attributed only when the corpus count settles which. */
export interface HostTurnFingerprint {
  readonly fingerprint: string | undefined;
  readonly failed: boolean;
}

export interface CorpusAttribution {
  /** Partition i is the i-th settled non-failed path turn's provider content: a prefix of the
   * candidates, or all of them when the corpus tail was aligned behind hidden pre-graph history. */
  readonly attributed: ProviderPartition[];
  /** Per failed path turn, in order: its own partition when every failed turn provably left one. */
  readonly failed: ReadonlyArray<ProviderPartition | undefined>;
  /** Per attributed turn: the user row of the next verified partition in corpus order — a failed
   * turn's included — or the in-flight row; where a fork after that turn cuts. */
  readonly successors: ReadonlyArray<AgentHistoryEvent | undefined>;
  /** Rows before the first attributed partition — those ahead of the first user row, plus the
   * hidden history's own partitions — rendered unattributed, as a cold read would. */
  readonly leading: AgentHistoryEvent[];
  /** The in-flight turn's own user row, when a trailing extra partition fingerprint-verified as it. */
  readonly trailingLive?: AgentHistoryEvent;
}

/** Whether provider rows can precede the lineage's root turn: an imported transcript, or a created
 * session whose earlier runs wrote provider history before the root was recorded (a session older
 * than its turn rows). A run that died before its first prompt, or was abandoned, left nothing
 * behind. */
export function hasHiddenPrefix(record: SessionRecord, root: ConversationTurn): boolean {
  if (record.origin.type !== 'created') return true;
  const index = record.runs.findIndex((run) => run.runId === root.runId);
  // A root whose run cannot be placed (a pre-runId record) takes the safe direction.
  if (index < 0) return true;
  return record.runs
    .slice(0, index)
    .some((run) => run.historyId !== undefined && run.abandonedAt === undefined);
}

/** The path turns that expect provider rows: settled, and not failed (nothing durable ran). */
export function settledWithProvider(path: readonly ConversationTurn[]): ConversationTurn[] {
  return path.filter((turn) => TERMINAL_TURN_STATES.has(turn.state) && turn.state !== 'failed');
}

/** Root→leaf path through `parentTurnId`; a broken chain fails loud rather than rendering wrong. */
export function pathToLeaf(
  byId: ReadonlyMap<TurnId, ConversationTurn>,
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
 * when it fingerprint-verifies as the in-flight turn's own row (the live tail owns it). Failed turns
 * make the expected count itself uncertain, so a lineage carrying one aligns from the START only:
 * every failed turn left a row (the count says so and each verifies), none did, or — ambiguous —
 * only the prefix before the first failed turn attributes.
 */
export function attributeCorpus(
  corpus: readonly AgentHistoryEvent[],
  hostTurns: ReadonlyArray<HostTurnFingerprint>,
  liveFingerprint: string | undefined,
  hiddenPrefixAllowed = false,
): CorpusAttribution {
  const settled: Array<string | undefined> = [];
  let failedCount = 0;
  for (let i = 0, len = hostTurns.length; i < len; i++) {
    if (hostTurns[i].failed) failedCount += 1;
    else settled.push(hostTurns[i].fingerprint);
  }
  const none = noAttribution(failedCount);
  const split = partitionAtUserRows(corpus);
  const { partitions } = split;
  let candidates = partitions;
  let trailingLive: AgentHistoryEvent | undefined;
  const trailing = partitions.at(-1);
  if (
    trailing !== undefined &&
    liveFingerprint !== undefined &&
    partitions.length > settled.length &&
    userRowFingerprint(trailing.userRow) === liveFingerprint
  ) {
    trailingLive = trailing.userRow;
    candidates = partitions.slice(0, -1);
  }
  if (failedCount > 0) {
    return attributeAroundFailed(
      split.leading,
      candidates,
      hostTurns,
      settled.length,
      trailingLive,
      hiddenPrefixAllowed,
    );
  }
  const hidden = candidates.length - settled.length;
  if (hidden < 0 || (!hiddenPrefixAllowed && hidden > 0)) return none;
  const aligned = candidates.slice(hidden);
  const attributed: ProviderPartition[] = [];
  for (let i = 0, len = aligned.length; i < len; i++) {
    if (!positionVerifies(aligned[i], settled[i])) break;
    attributed.push(aligned[i]);
  }
  if (attributed.length === 0) return none;
  // Anchored at the end (hidden rows ahead, or the live row peeled where hidden rows may exist),
  // one mismatch leaves the whole alignment unproven — and so does any other offset that verifies
  // in full: the replay binding a wrong alignment backfills is never corrected.
  if (hiddenPrefixAllowed && (trailingLive !== undefined || hidden > 0)) {
    if (attributed.length !== aligned.length) return none;
    for (let k = 0, last = partitions.length - settled.length; k <= last; k++) {
      if (k !== hidden && windowVerifies(partitions, k, settled)) return none;
    }
  }
  const leading = [...split.leading];
  for (let i = 0; i < hidden; i++) {
    const partition = candidates[i];
    leading.push(partition.userRow);
    for (let j = 0, len = partition.rest.length; j < len; j++) leading.push(partition.rest[j]);
  }
  const complete = attributed.length === aligned.length;
  const successors: Array<AgentHistoryEvent | undefined> = [];
  for (let i = 0, len = attributed.length; i < len; i++) {
    // The live row is the successor of the LAST settled turn only when every position verified.
    successors.push(i + 1 < len ? attributed[i + 1].userRow : complete ? trailingLive : undefined);
  }
  return {
    attributed,
    failed: [],
    successors,
    leading,
    ...(complete && trailingLive !== undefined && { trailingLive }),
  };
}

function noAttribution(failedCount: number): CorpusAttribution {
  const failed: Array<ProviderPartition | undefined> = [];
  for (let i = 0; i < failedCount; i++) failed.push(undefined);
  return { attributed: [], failed, successors: [], leading: [] };
}

/** Start-anchored alignment through failed turns: the corpus count decides whether every failed
 * turn consumes a partition (`all`), none does (`none`), or the answer is unknowable — then only
 * the prefix before the first failed turn attributes; a wrong guess would splice a later turn's
 * rows under the wrong prompt. Where hidden pre-graph rows are possible, an extra partition could
 * be either, and even the first position cannot be trusted (an identical hidden prompt verifies),
 * so any surplus attributes nothing. */
function attributeAroundFailed(
  leading: readonly AgentHistoryEvent[],
  candidates: readonly ProviderPartition[],
  hostTurns: ReadonlyArray<HostTurnFingerprint>,
  settledCount: number,
  trailingLive: AgentHistoryEvent | undefined,
  hiddenPrefixPossible: boolean,
): CorpusAttribution {
  const failedCount = hostTurns.length - settledCount;
  if (candidates.length < settledCount) return noAttribution(failedCount);
  if (hiddenPrefixPossible && candidates.length !== settledCount) return noAttribution(failedCount);
  const mode =
    candidates.length === settledCount
      ? 'none'
      : candidates.length === hostTurns.length
        ? 'all'
        : 'ambiguous';
  const attributed: ProviderPartition[] = [];
  const failed: Array<ProviderPartition | undefined> = [];
  const consumedAt: number[] = [];
  let next = 0;
  let broken = false;
  for (let i = 0, len = hostTurns.length; i < len; i++) {
    const turn = hostTurns[i];
    if (turn.failed) {
      if (mode === 'ambiguous') broken = true;
      const partition = mode === 'all' && !broken ? candidates[next] : undefined;
      if (partition === undefined || !positionVerifies(partition, turn.fingerprint)) {
        if (mode === 'all') broken = true;
        failed.push(undefined);
        continue;
      }
      failed.push(partition);
      next += 1;
      continue;
    }
    if (broken) continue;
    const partition = candidates[next];
    if (partition === undefined || !positionVerifies(partition, turn.fingerprint)) {
      broken = true;
      continue;
    }
    attributed.push(partition);
    consumedAt.push(next);
    next += 1;
  }
  const complete = !broken && next === candidates.length;
  const successors: Array<AgentHistoryEvent | undefined> = [];
  for (let i = 0, len = consumedAt.length; i < len; i++) {
    const following = consumedAt[i] + 1;
    successors.push(
      following < next ? candidates[following].userRow : complete ? trailingLive : undefined,
    );
  }
  return {
    attributed,
    failed,
    successors,
    leading: [...leading],
    ...(complete && trailingLive !== undefined && { trailingLive }),
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
