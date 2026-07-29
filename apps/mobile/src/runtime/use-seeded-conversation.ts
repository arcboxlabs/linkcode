import type { Conversation, ConversationSeed, ConversationSeedEvent } from '@linkcode/client-core';
import { useConversation, useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionInfo } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** Upper bound on cursor pages one seed read follows, so a buggy cursor can't loop forever. */
const MAX_SEED_PAGES = 20;

/**
 * The session's conversation view-model seeded from provider history — the live `agent.event`
 * subscription only covers this connection, so a cold-opened session replays its past from
 * `history.read` (same read walk as workbench's useSeededConversation, without the SWR cache).
 * A failed read degrades to live-only; the seed is keyed by session so it never bleeds across.
 */
export function useSeededConversation(
  sessionId: SessionId | null,
  session: SessionInfo | null,
): Conversation {
  const client = useLinkCodeClient();
  const [seeded, setSeeded] = useState<{ for: SessionId; seed: ConversationSeed } | null>(null);

  const agentKind = session?.kind;
  const cwd = session?.cwd;
  const historyId = session?.historyId;

  // Announce on the route's id, not on the resolved `SessionInfo`: the session list arrives a
  // round-trip later, and under `attached` delivery everything emitted in that window is dropped.
  // The attach replay would not recover it — it carries control state only, and an in-flight
  // reply's chunks are not in `history.read` yet either, so the turn would render truncated.
  // Announcing before the seed read is also what keeps a re-broadcast ask: it lands inside the
  // seed's `uptoSeq` cut, which only drops what the transcript verifiably covers (CODE-35).
  useEffect(() => {
    if (!sessionId) return;
    client.attachSession(sessionId);
    return () => client.detachSession(sessionId);
  }, [client, sessionId]);

  useEffect(
    (signal) => {
      if (!agentKind || !historyId || !sessionId) return;
      void (async () => {
        const events: ConversationSeedEvent[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_SEED_PAGES; page += 1) {
          // eslint-disable-next-line no-await-in-loop -- cursor pagination: each page's cursor comes from the previous reply
          const result = await client.readHistory(agentKind, {
            historyId,
            cwd,
            cursor,
            forceRefresh: page === 0,
          });
          for (const entry of result.events) events.push({ event: entry.event, ts: entry.ts });
          cursor = result.cursor;
          if (cursor === undefined) break;
        }
        if (signal.aborted) return;
        setSeeded({
          for: sessionId,
          seed: { events, uptoSeq: client.eventSeq(sessionId) },
        });
      })().catch(noop);
    },
    [agentKind, client, cwd, historyId, sessionId],
  );

  return useConversation(sessionId, seeded?.for === sessionId ? seeded.seed : undefined);
}
