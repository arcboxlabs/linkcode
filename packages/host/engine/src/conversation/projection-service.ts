import { Buffer } from 'node:buffer';
import { boundedLimit, cursorOffset } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryEvent,
  AgentHistoryId,
  ContentBlock,
  ConversationGraphTurn,
  ConversationReadItem,
  ConversationTurn,
  ConversationWatermark,
  SessionId,
  SessionRecord,
  TurnId,
} from '@linkcode/schema';
import {
  compareConversationWatermarks,
  MAX_ATTACHMENT_TOTAL_BASE64_LENGTH,
  MessageIdSchema,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import type { HistoryService } from '../session/history-service';
import { promptContentFingerprint } from '../session/live-session';
import type { SessionRecordRegistry } from '../session/session-record-registry';
import type { ConversationLiveJournals } from './live-journal';
import { inflightChunkKey } from './live-journal';
import type { ConversationTurnService } from './turn-service';
import { TERMINAL_TURN_STATES } from './turn-service';

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
const WHITESPACE_RUN_RE = /\s+/g;
/** One page = one logical tunnel message; oversized reassembly is silently dropped by the tunnel
 * (the history-util.ts byte-budget rationale applies verbatim). */
const READ_PAGE_BYTE_BUDGET = MAX_ATTACHMENT_TOTAL_BASE64_LENGTH;

interface ProviderPartition {
  readonly userRow: AgentHistoryEvent;
  readonly rest: AgentHistoryEvent[];
}

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
    private readonly history: HistoryService,
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
      // Positional attribution is sound only on the active lineage: a sibling lineage has the
      // same path length by construction (and can carry identical prompt text on a retry), so an
      // inactive-leaf read renders host rows + placeholders until per-turn bindings (CODE-632).
      const isActiveLineage = leafTurnId !== undefined && leafTurnId === record.activeLeafTurnId;
      const durable = yield* composeDurable(record, path, isActiveLineage);
      const { tail, watermark } = composeTail(request.sessionId, record.eventEpoch, path);
      const { events, cursor } = pageReadItems(
        durable,
        tail,
        cursorOffset(request.cursor),
        boundedLimit(request.limit, 1000, 1000),
      );
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
    isActiveLineage: boolean,
  ): Effect.Effect<ConversationReadItem[], OperationError> {
    const { records } = this;
    const readProviderEvents = this.readProviderEvents.bind(this);
    const hostUserContent = this.hostUserContent.bind(this);
    return Effect.gen(function* () {
      const items: ConversationReadItem[] = [];
      const contents: (ContentBlock[] | undefined)[] = [];
      for (let i = 0, len = path.length; i < len; i++) {
        contents.push(yield* hostUserContent(path[i]));
      }
      const cold = path.filter((turn) => TERMINAL_TURN_STATES.has(turn.state));
      // A failed turn expects no provider rows (nothing durable ran) and gets no placeholder.
      const expectsProvider = cold.filter((turn) => turn.state !== 'failed');
      const liveIndex = path.findIndex((turn) => !TERMINAL_TURN_STATES.has(turn.state));
      const historyId = records.historyId(record.sessionId);
      let attributed: ProviderPartition[] = [];
      let leading: AgentHistoryEvent[] = [];
      if (isActiveLineage && historyId !== undefined && expectsProvider.length > 0) {
        const corpus = yield* readProviderEvents(record, historyId);
        if (corpus !== undefined) {
          const hostFingerprints: (string | undefined)[] = [];
          for (let i = 0, len = path.length; i < len; i++) {
            const turn = path[i];
            if (!TERMINAL_TURN_STATES.has(turn.state) || turn.state === 'failed') continue;
            const content = contents[i];
            hostFingerprints.push(content && promptContentFingerprint(content));
          }
          let liveFingerprint: string | undefined;
          if (liveIndex >= 0) {
            const liveContent = contents[liveIndex];
            if (liveContent) liveFingerprint = promptContentFingerprint(liveContent);
          }
          const result = attributeCorpus(corpus, hostFingerprints, liveFingerprint);
          attributed = result.attributed;
          leading = result.leading;
        }
      }
      for (let i = 0, len = leading.length; i < len; i++) {
        items.push(projectedItem(undefined, leading[i]));
      }
      let partitionIndex = 0;
      for (let i = 0, len = path.length; i < len; i++) {
        const turn = path[i];
        const content = contents[i];
        if (content !== undefined) items.push(projectedUserRow(turn, content));
        if (!TERMINAL_TURN_STATES.has(turn.state)) continue; // in-flight output rides the live tail
        if (turn.state === 'failed') continue; // nothing durable ran; the state badge is the story
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
    // Cold sessions cut the whole current epoch: nothing mints under it again (every launch and
    // boot bumps it), so buffered stragglers from it are provably superseded by this read.
    let watermark: ConversationWatermark = { epoch: eventEpoch, seq: Number.MAX_SAFE_INTEGER };
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
      for (let i = 0, len = snapshot.length; i < len; i++) {
        const entry = snapshot[i];
        if (
          cut !== undefined &&
          compareConversationWatermarks({ epoch: entry.epoch, seq: entry.seq }, cut) <= 0
        ) {
          continue;
        }
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

  /** The full provider corpus behind the TTL cache, or undefined when unreadable — unsupported
   * harness, failed read (CODE-645), deleted transcript — so the caller degrades to prompt-only. */
  private readProviderEvents(
    record: SessionRecord,
    historyId: AgentHistoryId,
  ): Effect.Effect<AgentHistoryEvent[] | undefined> {
    const { history } = this;
    const { cwd, kind, sessionId } = record;
    // A cached corpus captured before the newest settle can miss that turn's rows (or hold its
    // partial answer) — bypass it so a post-settle read never attributes a stale slice.
    const freshAfter = this.turns.lastSettledAt(sessionId);
    return Effect.gen(function* () {
      const events: AgentHistoryEvent[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        // cwd is load-bearing for codex: its rollout home resolves through the project env.
        const result = yield* history.read(kind, {
          historyId,
          cwd,
          cursor,
          freshAfter,
          limit: 1000,
        });
        for (let i = 0, len = result.events.length; i < len; i++) events.push(result.events[i]);
        cursor = result.cursor;
        if (cursor !== undefined) {
          if (seenCursors.has(cursor)) {
            return yield* Effect.fail(
              new OperationError({
                subsystem: 'agent',
                operation: 'conversation.read.history',
                publicMessage: 'Provider history read returned a repeated cursor',
                cause: undefined,
              }),
            );
          }
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
      return events;
    }).pipe(
      Effect.catch((error) =>
        (error instanceof OperationError
          ? Effect.logWarning(
              'Provider history unavailable for conversation read',
              { sessionId, operation: error.operation },
              error.cause,
            )
          : Effect.void
        ).pipe(Effect.as(undefined)),
      ),
    );
  }

  /** The turn's user-row content from host truth; undefined for migrated null-prompt turns
   * (which render as placeholders until per-turn bindings land, CODE-632). */
  private hostUserContent(
    turn: ConversationTurn,
  ): Effect.Effect<ContentBlock[] | undefined, OperationError> {
    const input = turn.input;
    if (input.type === 'command' || input.type === 'shell-command') {
      return Effect.succeed([{ type: 'text' as const, text: inputText(input) }]);
    }
    if (input.promptId === null) return Effect.undefined;
    return this.turns.getPrompt(input.promptId).pipe(
      Effect.map((prompt) => {
        if (!prompt) return;
        // attachment_ref blocks join the projection when the attachment store lands.
        return prompt.blocks.flatMap((block) =>
          block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : [],
        );
      }),
    );
  }

  private inputSummary(turn: ConversationTurn): Effect.Effect<string | undefined, OperationError> {
    const input = turn.input;
    if (input.type === 'command' || input.type === 'shell-command') {
      return Effect.succeed(truncateSummary(inputText(input)));
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
): { events: ConversationReadItem[]; cursor?: string } {
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
  if (index < durable.length) return { events: page, cursor: String(index) };
  const trimmedTail = trimTailToBudget(tail, budget);
  const tailBytes = trimmedTail.reduce((sum, item) => sum + itemBytes(item), 0);
  if (page.length > 0 && trimmedTail.length > 0 && pageBytes + tailBytes > budget) {
    return { events: page, cursor: String(index) };
  }
  return { events: [...page, ...trimmedTail] };
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

/** Root→leaf path through `parentTurnId`; a broken chain fails loud rather than rendering wrong. */
function pathToLeaf(
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
function attributeCorpus(
  corpus: readonly AgentHistoryEvent[],
  hostFingerprints: ReadonlyArray<string | undefined>,
  liveFingerprint: string | undefined,
): { attributed: ProviderPartition[]; leading: AgentHistoryEvent[] } {
  const none = { attributed: [], leading: [] };
  const split = partitionAtUserRows(corpus);
  let candidates = split.partitions;
  const trailing = candidates.at(-1);
  if (trailing !== undefined && candidates.length === hostFingerprints.length + 1) {
    if (liveFingerprint === undefined || userRowFingerprint(trailing.userRow) !== liveFingerprint) {
      return none;
    }
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
  return { attributed, leading: attributed.length > 0 ? split.leading : [] };
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

function projectedUserRow(turn: ConversationTurn, content: ContentBlock[]): ConversationReadItem {
  return {
    turnId: turn.turnId,
    runId: turn.runId,
    ts: turn.createdAt,
    event: {
      type: 'user-message',
      // Deterministic identity: re-reads and page overlaps converge on one row per turn.
      messageId: MessageIdSchema.parse(`msg-${turn.turnId}`),
      content,
    },
  };
}

function inputText(
  input: Extract<ConversationTurn['input'], { type: 'command' | 'shell-command' }>,
): string {
  return input.type === 'command'
    ? `/${input.name}${input.arguments === undefined ? '' : ` ${input.arguments}`}`
    : `$ ${input.command}`;
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
