import type { Conversation, ConversationSeed, ConversationSeedEvent } from '@linkcode/client-core';
import { useConversation, useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionInfo } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** Upper bound on cursor pages one seed read follows, so a buggy cursor can't loop forever. */
const MAX_SEED_PAGES = 20;

/**
 * The session's conversation view-model seeded from provider history — the live `agent.event`
 * subscription only covers this connection, so a cold-opened session replays its past from
 * `history.read` (same read walk as workbench's useSeededConversation, without the SWR cache).
 * A failed read degrades to live-only; the seed is keyed by session so it never bleeds across.
 */
export function useSeededConversation(session: SessionInfo | null): Conversation {
  const client = useLinkCodeClient();
  const [seeded, setSeeded] = useState<{ for: SessionId; seed: ConversationSeed } | null>(null);

  const agentKind = session?.kind;
  const historyId = session?.historyId;
  const sessionId = session?.sessionId ?? null;

  useAbortableEffect(
    (signal) => {
      if (!agentKind || !historyId || !sessionId) return;
      void (async () => {
        const events: ConversationSeedEvent[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_SEED_PAGES; page += 1) {
          // eslint-disable-next-line no-await-in-loop -- cursor pagination: each page's cursor comes from the previous reply
          const result = await client.readHistory(agentKind, {
            historyId,
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
    [agentKind, client, historyId, sessionId],
  );

  return useConversation(sessionId, seeded?.for === sessionId ? seeded.seed : undefined);
}
