import type { Conversation, ConversationSeed } from '@linkcode/client-core';
import { useConversation, useLinkCodeClient } from '@linkcode/client-core';
import type { AgentEvent, SessionInfo } from '@linkcode/schema';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** Upper bound on cursor pages one seed read follows, so a buggy cursor can't loop forever. */
const MAX_SEED_PAGES = 20;

/**
 * Mobile port of workbench's `useSeededConversation` *logic* (that implementation is
 * SWR/tayori-tied): walk `history.read` to the end, mark the ordered cut with the live
 * receive counter, and seed the conversation store. Until the read resolves (or when the
 * session has no history yet) the view is live-events-only. Persisted seed cache is M3.
 */
export function useSeededConversation(info: SessionInfo | null): Conversation {
  const client = useLinkCodeClient();
  // Keyed by session+history identity so a stale snapshot never bleeds across a session
  // switch — no synchronous reset needed, the key mismatch filters it out during render.
  const [loaded, setLoaded] = useState<{ key: string; seed: ConversationSeed } | null>(null);

  const sessionId = info?.sessionId ?? null;
  const historyId = info?.historyId;
  const agentKind = info?.kind;
  const seedKey = sessionId && historyId ? `${sessionId}:${historyId}` : null;

  useEffect(
    (signal) => {
      if (!sessionId || !historyId || !agentKind || !seedKey) return;
      void (async () => {
        try {
          const events: AgentEvent[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < MAX_SEED_PAGES; page += 1) {
            // eslint-disable-next-line no-await-in-loop -- cursor pagination: each page's cursor comes from the previous reply
            const result = await client.readHistory(agentKind, {
              historyId,
              cursor,
              forceRefresh: page === 0,
            });
            for (const entry of result.events) events.push(entry.event);
            cursor = result.cursor;
            if (cursor === undefined) break;
          }
          if (signal.aborted) return;
          setLoaded({ key: seedKey, seed: { events, uptoSeq: client.eventSeq(sessionId) } });
        } catch (error) {
          // A failed read degrades to the live-only view; the transcript refills on retry/reopen.
          console.warn('[mobile] history seed failed', error);
        }
      })();
    },
    [client, sessionId, historyId, agentKind, seedKey],
  );

  return useConversation(sessionId, loaded?.key === seedKey ? loaded.seed : undefined);
}
