import { Buffer } from 'node:buffer';
import { boundedLimit } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryEvent,
  AgentHistoryId,
  ContentBlock,
  ConversationGraphTurn,
  ConversationReadItem,
  ConversationTurn,
  ConversationTurnState,
  ConversationWatermark,
  RunId,
  SessionId,
  SessionRecord,
  TurnId,
} from '@linkcode/schema';
import {
  compareConversationWatermarks,
  MAX_ATTACHMENT_TOTAL_BASE64_LENGTH,
  TurnIdSchema,
  userRowMessageId,
} from '@linkcode/schema';
import { Effect } from 'effect';
import type { OperationError } from '../failure';
import { RequestError } from '../failure';
import { encodeLiveBranchCursor } from '../session/live-session';
import type { SessionRecordRegistry } from '../session/session-record-registry';
import type { ConversationCheckpointService } from './checkpoint-service';
import type { CorpusAttribution, ProviderPartition } from './lineage-attribution';
import { pathToLeaf } from './lineage-attribution';
import type { ConversationLiveJournals } from './live-journal';
import { inflightChunkKey } from './live-journal';
import type { ConversationTurnService } from './turn-service';
import { TERMINAL_TURN_STATES, turnInputText } from './turn-service';

export interface ConversationGraphResult {
  readonly sessionId: SessionId;
  readonly graphRevision: number;
  readonly activeLeafTurnId?: TurnId;
  readonly turns: ConversationGraphTurn[];
}

export interface ConversationReadRequest {
  readonly sessionId: SessionId;
  readonly leafTurnId?: TurnId | undefined;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ConversationReadResult {
  readonly sessionId: SessionId;
  readonly graphRevision: number;
  readonly leafTurnId?: TurnId;
  /** Present ONLY on the final page, together with the live tail. */
  readonly watermark?: ConversationWatermark;
  readonly events: ConversationReadItem[];
  readonly cursor?: string;
}

/** One history's attribution plus each of its turns' index into it (settled non-failed / failed). */
interface HistoryRead {
  readonly attribution: CorpusAttribution;
  readonly partition: ReadonlyMap<TurnId, number>;
  readonly failed: ReadonlyMap<TurnId, number>;
}

const INPUT_SUMMARY_MAX_LENGTH = 140;
/** Turns a peer can see: running or settled. */
const VISIBLE_TURN_STATES = new Set<ConversationTurnState>(['running', ...TERMINAL_TURN_STATES]);
const WHITESPACE_RUN_RE = /\s+/g;
/** One page = one logical tunnel message; oversized reassembly is silently dropped by the tunnel
 * (the history-util.ts byte-budget rationale applies verbatim). The live journal's byte cap
 * (10 MiB) sits under this, so a retained tail never trims in production; `trimTailToBudget`
 * backs the invariant for the smaller budgets tests use. */
const READ_PAGE_BYTE_BUDGET = MAX_ATTACHMENT_TOTAL_BASE64_LENGTH;

/**
 * Composes the root→leaf conversation projection: user rows from the durable ConversationStore
 * (host truth — never provider history, never the journal), assistant/tool events from provider
 * history, the live tail from the bounded live journal merged by `(epoch, seq)` stamp. Provider
 * lossiness or read failure degrades a turn to the prompt-only placeholder, never a broken read.
 */
export class ConversationProjectionService {
  constructor(
    private readonly turns: ConversationTurnService,
    private readonly records: SessionRecordRegistry,
    private readonly checkpoints: ConversationCheckpointService,
    private readonly journals: ConversationLiveJournals,
    /** Authoritative open interactive requests of the live session (the CODE-35 backstop). */
    private readonly openRequests: (sessionId: SessionId) => AgentEvent[],
  ) {}

  graph(
    sessionId: SessionId,
  ): Effect.Effect<ConversationGraphResult, RequestError | OperationError> {
    const { records, turns } = this;
    const inputSummary = this.inputSummary.bind(this);
    return Effect.gen(function* () {
      const record = records.get(sessionId);
      if (!record) {
        return yield* Effect.fail(
          new RequestError({ code: 'not_found', message: `Unknown session: ${sessionId}` }),
        );
      }
      const sessionTurns = yield* turns.listTurns(sessionId);
      sessionTurns.sort(byCreation);
      const graphTurns: ConversationGraphTurn[] = [];
      for (let i = 0, len = sessionTurns.length; i < len; i++) {
        // A turn that has not run yet is the submitting client's alone: peers see it once it runs
        // or fails, which is also when the tree announces it.
        if (!VISIBLE_TURN_STATES.has(sessionTurns[i].state)) continue;
        const summary = yield* inputSummary(sessionTurns[i]);
        graphTurns.push(
          summary === undefined ? sessionTurns[i] : { ...sessionTurns[i], inputSummary: summary },
        );
      }
      return {
        sessionId,
        graphRevision: record.graphRevision,
        ...(record.activeLeafTurnId !== undefined && {
          activeLeafTurnId: record.activeLeafTurnId,
        }),
        turns: graphTurns,
      };
    });
  }

  read(
    request: ConversationReadRequest,
  ): Effect.Effect<ConversationReadResult, RequestError | OperationError> {
    const { records, turns } = this;
    const composeDurable = this.composeDurable.bind(this);
    const composeTail = this.composeTail.bind(this);
    return Effect.gen(function* () {
      const record = records.get(request.sessionId);
      if (!record) {
        return yield* Effect.fail(
          new RequestError({
            code: 'not_found',
            message: `Unknown session: ${request.sessionId}`,
          }),
        );
      }
      const sessionTurns = yield* turns.listTurns(request.sessionId);
      const byId = new Map(sessionTurns.map((turn) => [turn.turnId, turn]));
      if (request.leafTurnId !== undefined && !byId.has(request.leafTurnId)) {
        return yield* Effect.fail(
          new RequestError({ code: 'not_found', message: `Unknown turn: ${request.leafTurnId}` }),
        );
      }
      const leafTurnId = request.leafTurnId ?? record.activeLeafTurnId;
      const path = pathToLeaf(byId, leafTurnId);
      // A bare offset would splice across mutations (a settle flips the attribution gate, the
      // leaf moves, garbage restarts silently): the cursor pins the exact projection shape it
      // paged, and any drift or undecodable cursor is a typed conflict — never a silent splice.
      const settled = path.filter((turn) => TERMINAL_TURN_STATES.has(turn.state)).length;
      const activePath =
        leafTurnId === record.activeLeafTurnId ? path : pathToLeaf(byId, record.activeLeafTurnId);
      const durable = yield* composeDurable(record, path, sessionTurns, activePath);
      let offset = 0;
      if (request.cursor !== undefined) {
        const decoded = decodeReadCursor(request.cursor);
        if (
          decoded?.graphRevision !== record.graphRevision ||
          decoded.leafTurnId !== leafTurnId ||
          decoded.settled !== settled ||
          // The item count pins the provider corpus too: rows gained or compacted between pages
          // (a cache refresh) would shift offsets without moving the graph.
          decoded.durable !== durable.length
        ) {
          return yield* Effect.fail(
            new RequestError({
              code: 'conflict',
              message: 'The conversation changed while paging; restart the read',
            }),
          );
        }
        offset = decoded.offset;
      }
      // The journal is the active run's: only the lineage that owns the running turn, or the host
      // default itself, may carry it — another version or an ancestor view reads durable rows only.
      const ownsTail =
        leafTurnId === record.activeLeafTurnId ||
        path.some((turn) => !TERMINAL_TURN_STATES.has(turn.state));
      const { tail, watermark } = composeTail(request.sessionId, record.eventEpoch, path, ownsTail);
      const { events, nextOffset } = pageReadItems(
        durable,
        tail,
        offset,
        boundedLimit(request.limit, 1000, 1000),
      );
      const cursor =
        nextOffset !== undefined && leafTurnId !== undefined
          ? JSON.stringify({
              graphRevision: record.graphRevision,
              leafTurnId,
              settled,
              durable: durable.length,
              offset: nextOffset,
            })
          : undefined;
      return {
        sessionId: request.sessionId,
        graphRevision: record.graphRevision,
        ...(leafTurnId !== undefined && { leafTurnId }),
        // ONLY the final page carries the live tail and the watermark the client merges against.
        ...(cursor === undefined ? { watermark } : { cursor }),
        events,
      };
    });
  }

  /** Host user rows for every path turn, provider assistant/tool events under the attribution
   * gate, placeholders where provider content is unavailable or unverifiable. Every turn reads the
   * history of the run that executed it — never a fork's copy of it (claude re-stamps the rows it
   * copies), so two versions render the turns they share identically; a forked session's copied
   * prefix likewise reads the source session's rows while that session exists. */
  private composeDurable(
    record: SessionRecord,
    path: ConversationTurn[],
    sessionTurns: ConversationTurn[],
    activePath: ConversationTurn[],
  ): Effect.Effect<ConversationReadItem[], OperationError> {
    const { checkpoints, records } = this;
    const readHistories = this.readHistories.bind(this);
    const loadContents = this.loadContents.bind(this);
    const copiedPrefixPartitions = this.copiedPrefixPartitions.bind(this);
    return Effect.gen(function* () {
      const contents = new Map<TurnId, ContentBlock[] | undefined>();
      const touched = new Set<AgentHistoryId>();
      for (let i = 0, len = path.length; i < len; i++) {
        const historyId = runHistoryId(record, path[i].runId);
        if (historyId !== undefined) touched.add(historyId);
      }
      const reads = yield* readHistories(record, sessionTurns, touched, contents);
      const pathContents = yield* loadContents(path, contents);
      // A fork's copy is still where a later fork after a copied turn cuts once that turn's own
      // history is gone, so the active lineage also backfills its prefix's bindings on the live
      // history. Rendering never reads this pass.
      const liveHistoryId = records.historyId(record.sessionId);
      if (
        path === activePath &&
        liveHistoryId !== undefined &&
        path.some((turn) => runHistoryId(record, turn.runId) !== liveHistoryId)
      ) {
        yield* checkpoints.attributeLineage(record, path, pathContents, liveHistoryId);
      }
      const copied = yield* copiedPrefixPartitions(
        record,
        path,
        new Map(sessionTurns.map((turn) => [turn.turnId, turn])),
        new Set([record.sessionId]),
      );

      const items: ConversationReadItem[] = [];
      // Rows ahead of the first user row are pre-graph history: they belong to the root's own
      // history alone — a fork child's leading rows are its copy of the prefix, rendered from the
      // source above.
      const rootHistoryId = path.length === 0 ? undefined : runHistoryId(record, path[0].runId);
      const rootRead = rootHistoryId === undefined ? undefined : reads.get(rootHistoryId);
      if (rootRead !== undefined) {
        const { leading } = rootRead.attribution;
        for (let i = 0, len = leading.length; i < len; i++) {
          items.push(projectedItem(undefined, leading[i]));
        }
      }
      for (let i = 0, len = path.length; i < len; i++) {
        const turn = path[i];
        const content = pathContents[i];
        if (content !== undefined) {
          items.push(projectedUserRow(turn, content, runHistoryId(record, turn.runId)));
        }
        if (!TERMINAL_TURN_STATES.has(turn.state)) continue; // in-flight output rides the live tail
        if (turn.state === 'failed') {
          // The state badge is the story; whatever the provider kept of the attempt renders under
          // it, and a turn that left nothing gets no placeholder — nothing durable ran.
          const historyId = runHistoryId(record, turn.runId);
          const read = historyId === undefined ? undefined : reads.get(historyId);
          const index = read?.failed.get(turn.turnId);
          const partial = index === undefined ? undefined : read?.attribution.failed[index];
          if (partial !== undefined) {
            for (let j = 0, restLen = partial.rest.length; j < restLen; j++) {
              items.push(projectedItem(turn, partial.rest[j]));
            }
          }
          continue;
        }
        const partition = copied.get(turn.turnId) ?? readPartition(reads, record, turn);
        if (partition !== undefined) {
          for (let j = 0, restLen = partition.rest.length; j < restLen; j++) {
            items.push(projectedItem(turn, partition.rest[j]));
          }
        } else {
          items.push({ type: 'history-unavailable', turnId: turn.turnId, runId: turn.runId });
        }
      }
      return items;
    });
  }

  /** Host user-row content per turn of `lineage`, loaded once per read through `cache`. */
  private loadContents(
    lineage: readonly ConversationTurn[],
    cache: Map<TurnId, ContentBlock[] | undefined>,
  ): Effect.Effect<Array<ContentBlock[] | undefined>, OperationError> {
    const { turns } = this;
    return Effect.gen(function* () {
      const missing = lineage.filter((turn) => !cache.has(turn.turnId));
      const loaded = yield* Effect.forEach(missing, (turn) => turns.hostUserContent(turn));
      for (let i = 0, len = missing.length; i < len; i++) cache.set(missing[i].turnId, loaded[i]);
      return lineage.map((turn) => cache.get(turn.turnId));
    });
  }

  /**
   * Attribute each history in `historyIds` against the session's turns whose runs wrote to it. A
   * provider history is one linear transcript, so those turns in chain order are its user rows —
   * the alignment the gate needs, whichever lineage reads. Reading a corpus also backfills replay
   * bindings on it.
   */
  private readHistories(
    record: SessionRecord,
    sessionTurns: readonly ConversationTurn[],
    historyIds: ReadonlySet<AgentHistoryId>,
    cache: Map<TurnId, ContentBlock[] | undefined>,
  ): Effect.Effect<Map<AgentHistoryId, HistoryRead>, OperationError> {
    const { checkpoints } = this;
    const loadContents = this.loadContents.bind(this);
    return Effect.gen(function* () {
      const turnsByHistory = new Map<AgentHistoryId, ConversationTurn[]>();
      const ordered = [...sessionTurns].sort(byCreation);
      for (let i = 0, len = ordered.length; i < len; i++) {
        const historyId = runHistoryId(record, ordered[i].runId);
        if (historyId === undefined) continue;
        const group = turnsByHistory.get(historyId);
        if (group) group.push(ordered[i]);
        else turnsByHistory.set(historyId, [ordered[i]]);
      }
      const reads = new Map<AgentHistoryId, HistoryRead>();
      for (const historyId of historyIds) {
        const hostTurns = chainOrder(turnsByHistory.get(historyId) ?? []);
        const contents = yield* loadContents(hostTurns, cache);
        const attribution = yield* checkpoints.attributeLineage(
          record,
          hostTurns,
          contents,
          historyId,
        );
        if (attribution === undefined) continue;
        const partition = new Map<TurnId, number>();
        const failed = new Map<TurnId, number>();
        for (let i = 0, len = hostTurns.length; i < len; i++) {
          const turn = hostTurns[i];
          if (!TERMINAL_TURN_STATES.has(turn.state)) continue;
          if (turn.state === 'failed') failed.set(turn.turnId, failed.size);
          else partition.set(turn.turnId, partition.size);
        }
        reads.set(historyId, { attribution, partition, failed });
      }
      return reads;
    });
  }

  /**
   * The provider rows a forked session's copied prefix renders from: the source session's own,
   * position by position along the lineage it copied, while that session exists. The provider's
   * copy is lossy (claude re-stamps the row it cut at), and the source rows are what every other
   * view of that lineage renders. A source that is itself a fork defers to its own source the same
   * way; a deleted source leaves the copy as the only source there is.
   */
  private copiedPrefixPartitions(
    record: SessionRecord,
    path: readonly ConversationTurn[],
    byId: ReadonlyMap<TurnId, ConversationTurn>,
    visited: ReadonlySet<SessionId>,
  ): Effect.Effect<Map<TurnId, ProviderPartition>, OperationError> {
    const partitions = new Map<TurnId, ProviderPartition>();
    const origin = record.forkOrigin;
    const copiedLeaf = record.runs[0]?.baseTurnId;
    const source = origin === undefined ? undefined : this.records.get(origin.sourceSessionId);
    if (
      origin === undefined ||
      source === undefined ||
      copiedLeaf === undefined ||
      visited.has(source.sessionId)
    ) {
      return Effect.succeed(partitions);
    }
    const { turns } = this;
    const readHistories = this.readHistories.bind(this);
    const copiedPrefixPartitions = this.copiedPrefixPartitions.bind(this);
    return Effect.gen(function* () {
      // Position i of the copied lineage is position i of the source lineage it was copied from;
      // the read path shares that lineage only up to its first turn of the session's own.
      const copiedPath = pathToLeaf(byId, copiedLeaf);
      const sourceTurns = yield* turns.listTurns(source.sessionId);
      const sourceById = new Map(sourceTurns.map((turn) => [turn.turnId, turn]));
      const sourcePath = pathToLeaf(sourceById, origin.sourceTurnId);
      const limit = Math.min(path.length, copiedPath.length, sourcePath.length);
      let shared = 0;
      while (shared < limit && path[shared].turnId === copiedPath[shared].turnId) shared += 1;
      if (shared === 0) return partitions;
      const sourcePrefix = sourcePath.slice(0, shared);
      const histories = new Set<AgentHistoryId>();
      for (let i = 0; i < shared; i++) {
        const historyId = runHistoryId(source, sourcePrefix[i].runId);
        if (historyId !== undefined) histories.add(historyId);
      }
      const reads = yield* readHistories(source, sourceTurns, histories, new Map());
      const inherited = yield* copiedPrefixPartitions(
        source,
        sourcePrefix,
        sourceById,
        new Set([...visited, source.sessionId]),
      );
      for (let i = 0; i < shared; i++) {
        const sourceTurn = sourcePrefix[i];
        const partition =
          inherited.get(sourceTurn.turnId) ?? readPartition(reads, source, sourceTurn);
        if (partition !== undefined) partitions.set(path[i].turnId, partition);
      }
      return partitions;
    });
  }

  /** The live tail: retained journal events above the last event attributed to a settled path
   * turn, minus user echoes (host rows own user display) and headless chunk streams, plus the
   * authoritative open interactive requests. The journal is the active run's, so a lineage that
   * does not own it (`ownsTail` false: another version, an ancestor view) gets durable rows only. */
  private composeTail(
    sessionId: SessionId,
    eventEpoch: number,
    path: ConversationTurn[],
    ownsTail: boolean,
  ): { tail: ConversationReadItem[]; watermark: ConversationWatermark } {
    const journal = this.journals.get(sessionId);
    const liveTurn = path.find((turn) => !TERMINAL_TURN_STATES.has(turn.state));
    const pathIds = new Set(path.map((turn) => turn.turnId));
    const tail: ConversationReadItem[] = [];
    const seenRequestIds = new Set<string>();
    const seenStatusIds = new Set<string>();
    // Journal-less sessions (cold, or a launch whose first event hasn't flowed) cut every prior
    // epoch and NOTHING in the current one: seqs start at 1, so the run's own events all compare
    // above {epoch, 0} — a client adopting this during the launch window drops nothing.
    let watermark: ConversationWatermark = { epoch: eventEpoch, seq: 0 };
    if (journal?.watermark !== undefined) watermark = journal.watermark;
    if (journal && ownsTail) {
      const snapshot = journal.snapshot();
      const terminalIds = new Set<TurnId>();
      for (let i = 0, len = path.length; i < len; i++) {
        if (TERMINAL_TURN_STATES.has(path[i].state)) terminalIds.add(path[i].turnId);
      }
      // The durable/live boundary: everything at or below the last event of a settled path turn
      // is already covered by durable sources (or superseded by their placeholders).
      let cut: ConversationWatermark | undefined;
      for (let i = 0, len = snapshot.length; i < len; i++) {
        const entry = snapshot[i];
        if (entry.turnId === undefined || !terminalIds.has(entry.turnId)) continue;
        const stamp = { epoch: entry.epoch, seq: entry.seq };
        if (cut === undefined || compareConversationWatermarks(stamp, cut) > 0) cut = stamp;
      }
      // tailAfter's gap semantics own the eviction question: eviction reaching ABOVE the cut may
      // have destroyed full-snapshot events (a settled tool call, a resolution) for good.
      const { events: aboveCut, gap } =
        cut === undefined ? { events: snapshot, gap: journal.truncated } : journal.tailAfter(cut);
      for (let i = 0, len = aboveCut.length; i < len; i++) {
        const entry = aboveCut[i];
        const event = entry.event;
        // An entry stamped for a turn off this lineage (a refused sibling) is another version's.
        if (entry.turnId !== undefined && !pathIds.has(entry.turnId)) continue;
        // User rows are host truth — a live echo must not double the durable row.
        if (event.type === 'user-message') continue;
        const chunkKey = inflightChunkKey(event);
        if (chunkKey !== undefined && journal.isChunkCleared(chunkKey)) continue;
        if (event.type === 'permission-request' || event.type === 'question-request') {
          seenRequestIds.add(event.requestId);
        } else if (event.type === 'prompt-response-status') {
          seenStatusIds.add(event.requestId);
        }
        tail.push({
          ...(entry.turnId !== undefined && { turnId: entry.turnId }),
          runId: entry.runId,
          epoch: entry.epoch,
          seq: entry.seq,
          ts: entry.ts,
          event,
        });
      }
      // The journal returns append order — a stale old-epoch straggler can sit after newer
      // entries; the projection merges by stamp, never array order.
      tail.sort(byStamp);
      // The retained tail is provably incomplete: what remains still renders, but the in-flight
      // turn carries the placeholder so the read never claims completeness for it.
      if (gap && liveTurn !== undefined) {
        tail.push({ type: 'history-unavailable', turnId: liveTurn.turnId, runId: liveTurn.runId });
      }
    }
    // CODE-35 backstop: open interactive requests — and the responding status of one being
    // answered — reach the reader even when their original events were evicted or fell below the
    // durable cut.
    const openRequests = ownsTail ? this.openRequests(sessionId) : [];
    for (let i = 0, len = openRequests.length; i < len; i++) {
      const request = openRequests[i];
      if (request.type === 'prompt-response-status') {
        if (seenStatusIds.has(request.requestId)) continue;
      } else if (request.type === 'permission-request' || request.type === 'question-request') {
        if (seenRequestIds.has(request.requestId)) continue;
      } else {
        continue;
      }
      tail.push({
        ...(liveTurn !== undefined && { turnId: liveTurn.turnId, runId: liveTurn.runId }),
        event: request,
      });
    }
    return { tail, watermark };
  }

  private inputSummary(turn: ConversationTurn): Effect.Effect<string | undefined, OperationError> {
    const input = turn.input;
    if (input.type === 'command' || input.type === 'shell-command') {
      return Effect.succeed(truncateSummary(turnInputText(input)));
    }
    if (input.promptId === null) return Effect.undefined;
    return this.turns.getPrompt(input.promptId).pipe(
      Effect.map((prompt) => {
        if (!prompt) return;
        const text = prompt.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(' ')
          .replaceAll(WHITESPACE_RUN_RE, ' ')
          .trim();
        return text.length === 0 ? undefined : truncateSummary(text);
      }),
    );
  }
}

/**
 * Slices the composed projection into pages under the shared byte budget: durable items page by
 * budget and `limit`; the live tail is atomic to the final page (trimmed from the front when it
 * alone exceeds the budget, clearing any in-flight stream whose deltas were dropped). The first
 * item of a page always ships, so pagination cannot stall on one oversized record.
 */
export function pageReadItems(
  durable: readonly ConversationReadItem[],
  tail: readonly ConversationReadItem[],
  offset: number,
  limit: number,
  budget = READ_PAGE_BYTE_BUDGET,
): { events: ConversationReadItem[]; nextOffset?: number } {
  const page: ConversationReadItem[] = [];
  let pageBytes = 0;
  let index = Math.min(offset, durable.length);
  for (const len = durable.length; index < len; index += 1) {
    if (page.length >= limit) break;
    const size = itemBytes(durable[index]);
    if (page.length > 0 && pageBytes + size > budget) break;
    pageBytes += size;
    page.push(durable[index]);
  }
  if (index < durable.length) return { events: page, nextOffset: index };
  const trimmedTail = trimTailToBudget(tail, budget);
  const tailBytes = trimmedTail.reduce((sum, item) => sum + itemBytes(item), 0);
  if (page.length > 0 && trimmedTail.length > 0 && pageBytes + tailBytes > budget) {
    return { events: page, nextOffset: index };
  }
  return { events: [...page, ...trimmedTail] };
}

interface ReadCursor {
  readonly graphRevision: number;
  readonly leafTurnId: TurnId;
  readonly settled: number;
  readonly durable: number;
  readonly offset: number;
}

function decodeReadCursor(raw: string): ReadCursor | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('graphRevision' in parsed) ||
    typeof parsed.graphRevision !== 'number' ||
    !('settled' in parsed) ||
    typeof parsed.settled !== 'number' ||
    !('durable' in parsed) ||
    typeof parsed.durable !== 'number' ||
    !('offset' in parsed) ||
    typeof parsed.offset !== 'number' ||
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0 ||
    !('leafTurnId' in parsed)
  ) {
    return undefined;
  }
  const leaf = TurnIdSchema.safeParse(parsed.leafTurnId);
  if (!leaf.success) return undefined;
  return {
    graphRevision: parsed.graphRevision,
    leafTurnId: leaf.data,
    settled: parsed.settled,
    durable: parsed.durable,
    offset: parsed.offset,
  };
}

function trimTailToBudget(
  tail: readonly ConversationReadItem[],
  budget: number,
): ConversationReadItem[] {
  let total = tail.reduce((sum, item) => sum + itemBytes(item), 0);
  if (total <= budget) return [...tail];
  const clearedKeys = new Set<string>();
  let start = 0;
  while (total > budget && start < tail.length - 1) {
    const removed = tail[start];
    start += 1;
    total -= itemBytes(removed);
    if ('event' in removed) {
      const key = inflightChunkKey(removed.event);
      if (key !== undefined) clearedKeys.add(key);
    }
  }
  const items = tail.slice(start);
  if (clearedKeys.size === 0) return items;
  // Same rule as journal eviction: a stream that lost deltas restarts, never splices headless.
  return items.filter((item) => {
    if (!('event' in item)) return true;
    const key = inflightChunkKey(item.event);
    return key === undefined || !clearedKeys.has(key);
  });
}

function itemBytes(item: ConversationReadItem): number {
  return Buffer.byteLength(JSON.stringify(item), 'utf8');
}

function projectedItem(
  turn: ConversationTurn | undefined,
  entry: AgentHistoryEvent,
): ConversationReadItem {
  return {
    ...(turn !== undefined && { turnId: turn.turnId, runId: turn.runId }),
    ...(entry.ts !== undefined && { ts: entry.ts }),
    event: entry.event,
  };
}

function runHistoryId(record: SessionRecord, runId: RunId): AgentHistoryId | undefined {
  return record.runs.find((run) => run.runId === runId)?.historyId;
}

/** The provider partition a settled turn renders from, off the read of its own run's history. */
function readPartition(
  reads: ReadonlyMap<AgentHistoryId, HistoryRead>,
  record: SessionRecord,
  turn: ConversationTurn,
): ProviderPartition | undefined {
  const historyId = runHistoryId(record, turn.runId);
  const read = historyId === undefined ? undefined : reads.get(historyId);
  const index = read?.partition.get(turn.turnId);
  return index === undefined ? undefined : read?.attribution.attributed[index];
}

/** The turns that ran on one history in transcript order: the chain through `parentTurnId` from
 * the turn whose parent ran elsewhere. Creation order (the input) stands when they form no chain. */
function chainOrder(group: ConversationTurn[]): ConversationTurn[] {
  const ids = new Set(group.map((turn) => turn.turnId));
  const childOf = new Map<TurnId, ConversationTurn>();
  let head: ConversationTurn | undefined;
  for (let i = 0, len = group.length; i < len; i++) {
    const turn = group[i];
    if (turn.parentTurnId !== null && ids.has(turn.parentTurnId)) {
      childOf.set(turn.parentTurnId, turn);
    } else {
      head ??= turn;
    }
  }
  const ordered: ConversationTurn[] = [];
  const total = group.length;
  let turn = head;
  let count = 0;
  // Bounded by the group size so a malformed graph cannot spin.
  while (turn !== undefined && count < total) {
    ordered.push(turn);
    count += 1;
    turn = childOf.get(turn.turnId);
  }
  return count === total ? ordered : group;
}

function projectedUserRow(
  turn: ConversationTurn,
  content: ContentBlock[],
  historyId: AgentHistoryId | undefined,
): ConversationReadItem {
  return {
    turnId: turn.turnId,
    runId: turn.runId,
    ts: turn.createdAt,
    event: {
      type: 'user-message',
      messageId: userRowMessageId(turn.turnId),
      content,
      // The cursor the live echo carries, so legacy `history.branch` can edit a row that was read
      // rather than seen live; absent until the run's adapter reports its history.
      ...(historyId !== undefined && {
        branchCursor: encodeLiveBranchCursor(historyId, turn.turnId),
      }),
    },
  };
}

function truncateSummary(text: string): string {
  return text.length > INPUT_SUMMARY_MAX_LENGTH
    ? `${text.slice(0, INPUT_SUMMARY_MAX_LENGTH - 1)}…`
    : text;
}

function byCreation(a: ConversationTurn, b: ConversationTurn): number {
  return a.createdAt - b.createdAt || a.turnId.localeCompare(b.turnId);
}

/** Lexicographic stamp order for journal-derived tail items (all stamped at sort time). */
function byStamp(a: ConversationReadItem, b: ConversationReadItem): number {
  if (!('event' in a) || !('event' in b)) return 0;
  return compareConversationWatermarks(
    { epoch: a.epoch ?? 0, seq: a.seq ?? 0 },
    { epoch: b.epoch ?? 0, seq: b.seq ?? 0 },
  );
}
