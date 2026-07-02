import type { Conversation, ConversationSeed } from '@linkcode/client-core';
import { useConversation } from '@linkcode/client-core';
import type {
  AgentEvent,
  AgentHistoryId,
  AgentKind,
  SessionId,
  SessionInfo,
} from '@linkcode/schema';
import type { Options, RequestResult } from '@linkcode/sdk';
import { resolveClient } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';
import { loadPersistedSeed, persistSeed } from './seed-cache';

/** Upper bound on cursor pages one seed read follows, so a buggy cursor can't loop forever. */
const MAX_SEED_PAGES = 20;

/**
 * Read a session's full provider transcript as a point-in-time snapshot. Pages are walked to the
 * end; the first page bypasses the daemon's history cache so the snapshot is current as of this
 * walk — `uptoSeq` (the live receive counter sampled at resolve) then marks the ordered cut: live
 * events at or before it are already in the snapshot.
 */
async function readConversationSeed(
  options: Options<{ agentKind: AgentKind; historyId: AgentHistoryId; sessionId: SessionId }>,
): RequestResult<ConversationSeed> {
  const client = resolveClient(options);
  const events: AgentEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SEED_PAGES; page += 1) {
    const { data } = await client.readHistory(options.agentKind, {
      historyId: options.historyId,
      cursor,
      forceRefresh: page === 0,
    });
    for (const entry of data.events) events.push(entry.event);
    cursor = data.cursor;
    if (cursor === undefined) break;
  }
  const seed: ConversationSeed = { events, uptoSeq: client.raw.eventSeq(options.sessionId) };
  // Persisted here, not in an onSuccess hook: the fetcher owns its params, so a session switch
  // mid-flight can't file the snapshot under the newly active session's key.
  persistSeed(options.agentKind, options.historyId, seed);
  return { data: seed };
}

/**
 * The active session's conversation view-model, seeded from persisted provider history. The live
 * `agent.event` subscription only covers this connection, so a cold-resumed (or re-attached)
 * session replays its past from `history.read`; new live events append behind the snapshot.
 * The last persisted snapshot serves as `fallbackData`, so reopening the app paints history
 * immediately while the fresh read revalidates behind it.
 */
export function useSeededConversation(
  active: SessionInfo | null,
  onError: (err: unknown) => void,
): Conversation {
  const { data: seed } = useData(
    readConversationSeed,
    active?.historyId
      ? { agentKind: active.kind, historyId: active.historyId, sessionId: active.sessionId }
      : null,
    {
      onError,
      fallbackData: active?.historyId
        ? loadPersistedSeed(active.kind, active.historyId)
        : undefined,
      // Opt out of the provider-wide keepPreviousData: on a session switch it would keep serving
      // the previous session's transcript — forever, when the new session has no historyId yet
      // (null key = no fetch to replace it). A conversation must never bleed across sessions.
      keepPreviousData: false,
    },
  );
  return useConversation(active?.sessionId ?? null, seed);
}
