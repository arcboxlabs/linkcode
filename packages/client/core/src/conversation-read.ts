import type {
  ConversationReadItem,
  ConversationWatermark,
  SessionId,
  TurnId,
} from '@linkcode/schema';
import { isErrorLikeObject } from 'foxts/extract-error-message';
import type { LinkCodeClient } from './client';

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
