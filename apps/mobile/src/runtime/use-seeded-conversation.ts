import type {
  Conversation,
  ConversationProjectionSeed,
  ConversationSeed,
} from '@linkcode/client-core';
import { readConversationSeed, useConversation, useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionInfo } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { useReducer, useState } from 'react';

type Seed = ConversationProjectionSeed | ConversationSeed;

/**
 * The session's conversation view-model seeded from the daemon: the turn-graph projection where the
 * host serves one, the provider transcript otherwise — the live `agent.event` subscription only
 * covers this connection (same read as workbench's useSeededConversation, without the SWR cache).
 * A failed read degrades to live-only; the seed is keyed by session so it never bleeds across, and
 * a projection store's resync request re-runs the read.
 */
export function useSeededConversation(
  sessionId: SessionId | null,
  session: SessionInfo | null,
): Conversation {
  const client = useLinkCodeClient();
  const [seeded, setSeeded] = useState<{ for: SessionId; seed: Seed } | null>(null);
  const [readGeneration, requestReread] = useReducer((n: number) => n + 1, 0);

  const agentKind = session?.kind;
  const cwd = session?.cwd;
  const historyId = session?.historyId;

  // Announce on the route's id, not on the resolved `SessionInfo`: the session list arrives a
  // round-trip later, and under `attached` delivery everything emitted in that window is dropped.
  // The attach replay would not recover it — it carries control state only, and an in-flight
  // reply's chunks are not in `history.read` yet either, so the turn would render truncated.
  // Announcing before the seed read is also what keeps a re-broadcast ask: it lands inside the
  // seed's cut, which only drops what the read verifiably covers (CODE-35).
  useEffect(() => {
    if (!sessionId) return;
    client.attachSession(sessionId);
    return () => client.detachSession(sessionId);
  }, [client, sessionId]);

  useEffect(
    (signal) => {
      if (!agentKind || cwd === undefined || !sessionId) return;
      void (async () => {
        const seed = await readConversationSeed(client, { sessionId, agentKind, cwd, historyId });
        if (seed === undefined || signal.aborted) return;
        setSeeded({ for: sessionId, seed });
      })().catch(noop);
    },
    [agentKind, client, cwd, historyId, sessionId, readGeneration],
  );

  return useConversation(
    sessionId,
    seeded?.for === sessionId ? seeded.seed : undefined,
    requestReread,
  );
}
