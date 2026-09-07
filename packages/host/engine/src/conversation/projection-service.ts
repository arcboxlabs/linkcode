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
import type { ProviderPartition } from './lineage-attribution';
import { pathToLeaf, settledWithProvider } from './lineage-attribution';
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

const INPUT_SUMMARY_MAX_LENGTH = 140;
/** Turns a peer can see: running or settled. */
const VISIBLE_TURN_STATES = new Set<ConversationTurnState>(['running', ...TERMINAL_TURN_STATES]);
const WHITESPACE_RUN_RE = /\s+/g;
/** One page = one logical tunnel message; oversized reassembly is silently dropped by the tunnel
 * (the history-util.ts byte-budget rationale applies verbatim). */
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
      let offset = 0;
      if (request.cursor !== undefined) {
        const decoded = decodeReadCursor(request.cursor);
        if (
          decoded?.graphRevision !== record.graphRevision ||
          decoded.leafTurnId !== leafTurnId ||
          decoded.settled !== settled
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
      const activePath =
        leafTurnId === record.activeLeafTurnId ? path : pathToLeaf(byId, record.activeLeafTurnId);
      const durable = yield* composeDurable(record, path, activePath);
      const { tail, watermark } = composeTail(request.sessionId, record.eventEpoch, path);
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
   * gate, placeholders where provider content is unavailable or unverifiable. */
  private composeDurable(
    record: SessionRecord,
    path: ConversationTurn[],
    activePath: ConversationTurn[],
  ): Effect.Effect<ConversationReadItem[], OperationError> {
    const { checkpoints, records, turns } = this;
    const hostContents = (
      lineage: ConversationTurn[],
    ): Effect.Effect<(ContentBlock[] | undefined)[], OperationError> =>
      Effect.forEach(lineage, (turn) => turns.hostUserContent(turn));
    return Effect.gen(function* () {
      const items: ConversationReadItem[] = [];
      const contents = yield* hostContents(path);
      let attributed: ProviderPartition[] = [];
      let failedPartitions: ReadonlyArray<ProviderPartition | undefined> = [];
      let leading: AgentHistoryEvent[] = [];
      const settled = settledWithProvider(path);
      const anchor = settled.at(-1);
      const activeIds = new Set(activePath.map((turn) => turn.turnId));
      const liveHistoryId = records.historyId(record.sessionId);
      // Reading a corpus also backfills replay bindings on it.
      const ownHistoryId =
        anchor === undefined || activeIds.has(anchor.turnId)
          ? undefined
          : runHistoryId(record, anchor.runId);
      if (ownHistoryId !== undefined && ownHistoryId !== liveHistoryId) {
        // An inactive lineage on a history of its own reads it whole: rows, cursors, and bindings
        // all live there — never the live copy a later fork made of its prefix.
        const attribution = yield* checkpoints.attributeLineage(
          record,
          path,
          contents,
          ownHistoryId,
        );
        if (attribution !== undefined) {
          attributed = attribution.attributed;
          failedPartitions = attribution.failed;
          leading = attribution.leading;
        }
      } else if (anchor !== undefined) {
        // The turns a lineage shares with the active one read where the active lineage reads: the
        // live history, verified from the start, cut to that shared prefix. Whatever lies beyond
        // stays a placeholder — a sibling sharing the live history has the same path length by
        // construction (and can repeat the prompt text on a retry), so slicing it positionally
        // would hand it the active lineage's rows.
        const shared = settled.filter((turn) => activeIds.has(turn.turnId)).length;
        if (shared > 0) {
          const attribution = yield* checkpoints.attributeLineage(
            record,
            activePath,
            activePath === path ? contents : yield* hostContents(activePath),
            liveHistoryId,
          );
          if (attribution !== undefined) {
            attributed = attribution.attributed.slice(0, shared);
            // A failed turn is always a leaf, so only the active lineage's own read has them.
            failedPartitions = activePath === path ? attribution.failed : [];
            leading = attribution.leading;
          }
        }
      }
      for (let i = 0, len = leading.length; i < len; i++) {
        items.push(projectedItem(undefined, leading[i]));
      }
      let partitionIndex = 0;
      let failedIndex = 0;
      for (let i = 0, len = path.length; i < len; i++) {
        const turn = path[i];
        const content = contents[i];
        if (content !== undefined) {
          items.push(projectedUserRow(turn, content, runHistoryId(record, turn.runId)));
        }
        if (!TERMINAL_TURN_STATES.has(turn.state)) continue; // in-flight output rides the live tail
        if (turn.state === 'failed') {
          // The state badge is the story; whatever the provider kept of the attempt renders under
          // it, and a turn that left nothing gets no placeholder — nothing durable ran.
          const partial = failedPartitions[failedIndex];
          failedIndex += 1;
          if (partial !== undefined) {
            for (let j = 0, restLen = partial.rest.length; j < restLen; j++) {
              items.push(projectedItem(turn, partial.rest[j]));
            }
          }
          continue;
        }
        const partition = attributed[partitionIndex];
        partitionIndex += 1;
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

  /** The live tail: retained journal events above the last event attributed to a settled path
   * turn, minus user echoes (host rows own user display) and headless chunk streams, plus the
   * authoritative open interactive requests. */
  private composeTail(
    sessionId: SessionId,
    eventEpoch: number,
    path: ConversationTurn[],
  ): { tail: ConversationReadItem[]; watermark: ConversationWatermark } {
    const journal = this.journals.get(sessionId);
    const liveTurn = path.find((turn) => !TERMINAL_TURN_STATES.has(turn.state));
    const tail: ConversationReadItem[] = [];
    const seenRequestIds = new Set<string>();
    // Journal-less sessions (cold, or a launch whose first event hasn't flowed) cut every prior
    // epoch and NOTHING in the current one: seqs start at 1, so the run's own events all compare
    // above {epoch, 0} — a client adopting this during the launch window drops nothing.
    let watermark: ConversationWatermark = { epoch: eventEpoch, seq: 0 };
    if (journal) {
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
        // User rows are host truth — a live echo must not double the durable row.
        if (event.type === 'user-message') continue;
        const chunkKey = inflightChunkKey(event);
        if (chunkKey !== undefined && journal.isChunkCleared(chunkKey)) continue;
        if (event.type === 'permission-request' || event.type === 'question-request') {
          seenRequestIds.add(event.requestId);
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
      if (journal.watermark !== undefined) watermark = journal.watermark;
    }
    // CODE-35 backstop: open interactive requests reach the reader even when their original
    // events were evicted or fell below the durable cut.
    const openRequests = this.openRequests(sessionId);
    for (let i = 0, len = openRequests.length; i < len; i++) {
      const request = openRequests[i];
      if (request.type !== 'permission-request' && request.type !== 'question-request') continue;
      if (seenRequestIds.has(request.requestId)) continue;
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
