import type { Conversation, ConversationSeed, ConversationSeedEvent } from '@linkcode/client-core';
import { useConversation } from '@linkcode/client-core';
import type { AgentHistoryId, AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import type { Options, RequestResult } from '@linkcode/sdk';
import { resolveClient } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';
import { loadPersistedSeed, persistSeed } from './seed-cache';

/** Upper bound on cursor pages one seed read follows, so a buggy cursor can't loop forever. */
const MAX_SEED_PAGES = 20;

/**
 * Read a session's full provider transcript as a point-in-time snapshot: pages walked to the end,
 * the first page bypassing the daemon's history cache so the snapshot is current. `uptoSeq` (the
 * live receive counter sampled at resolve) marks the cut: live events ≤ it are in the snapshot.
 */
async function readConversationSeed(
  options: Options<{ agentKind: AgentKind; historyId: AgentHistoryId; sessionId: SessionId }>,
): RequestResult<ConversationSeed> {
  const client = resolveClient(options);
  const events: ConversationSeedEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_SEED_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- cursor pagination: each page's cursor comes from the previous reply
    const { data } = await client.readHistory(options.agentKind, {
      historyId: options.historyId,
      cursor,
      forceRefresh: page === 0,
    });
    for (const entry of data.events) events.push({ event: entry.event, ts: entry.ts });
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
 * The active session's conversation view-model, seeded from provider history: the live
 * `agent.event` subscription only covers this connection, so a cold-resumed session replays its
 * past from `history.read`. The last persisted snapshot serves as `fallbackData` — reopening the
 * app paints history immediately while the fresh read revalidates behind it.
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
      // Opt out of keepPreviousData: a conversation must never bleed across sessions, and on a
      // switch it would serve the previous transcript — forever, when there's no historyId yet.
      keepPreviousData: false,
    },
  );
  return useConversation(active?.sessionId ?? null, seed);
}
