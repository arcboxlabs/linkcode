import type {
  AgentHistoryId,
  AgentKind,
  ConversationReadItem,
  ConversationWatermark,
  SessionId,
  TurnId,
} from '@linkcode/schema';
import { isErrorLikeObject } from 'foxts/extract-error-message';
import type { LinkCodeClient } from './client';
import type { ConversationSeed, ConversationSeedEvent } from './conversation';

/**
 * A point-in-time projection of one lineage, read from the daemon's turn graph: host user rows,
 * attributed provider events, placeholders, and the live tail — every `conversation.read` page of
 * one walk, taken as a single snapshot.
 */
export interface ConversationProjectionSeed {
  items: ConversationReadItem[];
  graphRevision: number;
  leafTurnId: TurnId;
  /** The final page's `(epoch, seq)` cut: live events at or below it are already in `items`.
   * Absent on a persisted seed, which then supersedes nothing. */
  watermark?: ConversationWatermark;
}

export interface ReadConversationOptions {
  /** Absent = the session's active leaf. */
  leafTurnId?: TurnId;
}

/** Cursor pages one walk follows before giving up on a buggy cursor. */
const MAX_PAGES = 50;
/** Walks restarted after the graph moved underneath one before giving up. */
const MAX_RESTARTS = 3;

class ProjectionDriftError extends Error {
  override readonly name = 'ProjectionDriftError';
}

/**
 * Walk `conversation.read` to its final page. Resolves undefined for a session with no turn graph
 * yet — pre-existing sessions keep `history.read` as their path until the single-lineage
 * migration. A `graphRevision` or leaf change between pages, or the daemon's typed `conflict`,
 * restarts the walk: two projections are never spliced.
 */
export async function readConversationProjection(
  client: LinkCodeClient,
  sessionId: SessionId,
  options: ReadConversationOptions = {},
): Promise<ConversationProjectionSeed | undefined> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- a restart depends on the previous walk's outcome
      return await walk(client, sessionId, options);
    } catch (error) {
      if (attempt >= MAX_RESTARTS || !isProjectionDrift(error)) throw error;
    }
  }
}

async function walk(
  client: LinkCodeClient,
  sessionId: SessionId,
  options: ReadConversationOptions,
): Promise<ConversationProjectionSeed | undefined> {
  const items: ConversationReadItem[] = [];
  let graphRevision: number | undefined;
  let leafTurnId: TurnId | undefined;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- cursor pagination: each page's cursor comes from the previous reply
    const result = await client.readConversation(sessionId, { ...options, cursor });
    if (result.leafTurnId === undefined) return undefined;
    graphRevision ??= result.graphRevision;
    leafTurnId ??= result.leafTurnId;
    if (result.graphRevision !== graphRevision || result.leafTurnId !== leafTurnId) {
      throw new ProjectionDriftError(`conversation ${sessionId} changed while paging`);
    }
    for (let i = 0, len = result.events.length; i < len; i++) items.push(result.events[i]);
    if (result.cursor === undefined) {
      return {
        items,
        graphRevision,
        leafTurnId,
        ...(result.watermark !== undefined && { watermark: result.watermark }),
      };
    }
    cursor = result.cursor;
  }
  throw new Error(`conversation.read for ${sessionId} did not end within ${MAX_PAGES} pages`);
}

function isProjectionDrift(error: unknown): boolean {
  if (error instanceof ProjectionDriftError) return true;
  return isErrorLikeObject(error) && 'code' in error && error.code === 'conflict';
}

/** What a seed read needs to know about the session; `historyId` gates the transcript fallback. */
export interface ConversationSeedSource {
  sessionId: SessionId;
  agentKind: AgentKind;
  cwd: string;
  historyId?: AgentHistoryId;
  /** Read toward this leaf instead of the session's active one — a client browsing an earlier
   * version. Only the projection path knows lineages; the transcript fallback ignores it. */
  leafTurnId?: TurnId;
}

/** Transcript pages one history read follows before giving up on a buggy cursor. */
const MAX_HISTORY_PAGES = 20;

/**
 * The seed a conversation store should fold for a session: the turn-graph projection when the
 * host serves one for this session, else the provider transcript (≤v79 hosts, and sessions with no
 * turn rows yet), else nothing — the store then runs live-only. Every client surface reads through
 * here so the two paths and their fallback order live in one place.
 */
export async function readConversationSeed(
  client: LinkCodeClient,
  source: ConversationSeedSource,
): Promise<ConversationProjectionSeed | ConversationSeed | undefined> {
  if (client.supportsConversationGraph) {
    const projection = await readConversationProjection(
      client,
      source.sessionId,
      source.leafTurnId === undefined ? {} : { leafTurnId: source.leafTurnId },
    );
    if (projection !== undefined) return projection;
  }
  if (source.historyId === undefined) return undefined;
  return readHistorySeed(client, source.sessionId, source.agentKind, source.cwd, source.historyId);
}

/**
 * The provider transcript as a point-in-time snapshot: pages walked to the end, the first page
 * bypassing the daemon's history cache so the snapshot is current. `uptoSeq` (the live receive
 * counter sampled at resolve) marks the cut: live events ≤ it are in the snapshot.
 */
async function readHistorySeed(
  client: LinkCodeClient,
  sessionId: SessionId,
  agentKind: AgentKind,
  cwd: string,
  historyId: AgentHistoryId,
): Promise<ConversationSeed> {
  const events: ConversationSeedEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- cursor pagination: each page's cursor comes from the previous reply
    const result = await client.readHistory(agentKind, {
      historyId,
      cwd,
      cursor,
      forceRefresh: page === 0,
    });
    for (let i = 0, len = result.events.length; i < len; i++) {
      const entry = result.events[i];
      events.push({ event: entry.event, ts: entry.ts });
    }
    cursor = result.cursor;
    if (cursor === undefined) break;
  }
  return { events, uptoSeq: client.eventSeq(sessionId) };
}
