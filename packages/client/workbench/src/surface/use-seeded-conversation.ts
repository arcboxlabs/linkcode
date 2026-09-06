import type {
  Conversation,
  ConversationGraphSnapshot,
  ConversationProjectionSeed,
  ConversationSeed,
  ConversationSeedSource,
} from '@linkcode/client-core';
import { readConversationSeed, useConversation } from '@linkcode/client-core';
import type { SessionInfo, TurnId } from '@linkcode/schema';
import type { Options, RequestResult } from '@linkcode/sdk';
import { resolveClient } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useEffect } from 'react';
import { useData } from '../runtime/tayori';
import { onActiveLineage, timelineLeftActiveLineage } from './lineage';
import { useLineageStore } from './lineage-store';
import {
  loadPersistedProjection,
  loadPersistedSeed,
  persistProjection,
  persistSeed,
} from './seed-cache';
import { useConversationGraph } from './use-conversation-graph';

interface SeedRead {
  seed: ConversationProjectionSeed | ConversationSeed;
  /** The parked version this read was made toward; absent for a read of the host default. */
  viewLeafTurnId?: TurnId;
}
/** SWR data is `undefined` while loading, so "nothing to seed" needs its own value. */
type SeedData = SeedRead | null;

/**
 * Read the seed for a session (see `readConversationSeed`) and persist it for the next reopen.
 * Persisted here, not in an onSuccess hook: the fetcher owns its params, so a session switch
 * mid-flight can't file the snapshot under the newly active session's key.
 */
async function fetchConversationSeed(
  options: Options<ConversationSeedSource>,
): RequestResult<SeedData> {
  // The parked leaf is read at fetch time, not keyed: switching versions revalidates in place
  // instead of flashing an empty timeline behind a new SWR key.
  const leafTurnId = useLineageStore.getState().parkedBySession[options.sessionId]?.leafTurnId;
  const seed = await readConversationSeed(resolveClient(options).raw, { ...options, leafTurnId });
  if (seed === undefined) return { data: null };
  // Only the host default is worth the reopen cache; a parked read is one version of many.
  if (leafTurnId !== undefined) return { data: { seed, viewLeafTurnId: leafTurnId } };
  if ('items' in seed) persistProjection(options.sessionId, seed);
  else if (options.historyId !== undefined) persistSeed(options.agentKind, options.historyId, seed);
  return { data: { seed } };
}

function persistedSeed(active: SessionInfo): SeedRead | undefined {
  const seed =
    loadPersistedProjection(active.sessionId) ??
    (active.historyId ? loadPersistedSeed(active.kind, active.historyId) : undefined);
  return seed === undefined ? undefined : { seed };
}

/**
 * The active session's conversation view-model, seeded from the daemon: the turn-graph projection
 * where the host serves one, the provider transcript otherwise (the live `agent.event`
 * subscription only covers this connection). The last persisted snapshot serves as
 * `fallbackData` — reopening the app paints history immediately while the fresh read revalidates
 * behind it — and a projection store's resync request is answered by re-running the read. The read
 * re-runs when the session's parked version changes (the lineage store) and when the timeline
 * shows a turn the tree's active lineage does not run through (an edit from any device). A read
 * made toward a parked version is frozen (`followLive: false`) until the active lineage runs
 * through that version; a read of the host default keeps folding the live stream, even while the
 * tree has moved past it and the re-read is in flight.
 */
export function useSeededConversation(
  active: SessionInfo | null,
  onError: (err: unknown) => void,
): { conversation: Conversation; graph: ConversationGraphSnapshot | undefined } {
  const { data, mutate } = useData(
    fetchConversationSeed,
    active
      ? {
          sessionId: active.sessionId,
          agentKind: active.kind,
          cwd: active.cwd,
          historyId: active.historyId,
        }
      : null,
    {
      onError,
      fallbackData: active ? persistedSeed(active) : undefined,
      // Never opt this into keepPreviousData: a conversation must not bleed across sessions, and
      // on a switch it would serve the previous transcript — forever, with no historyId yet.
    },
  );
  const sessionId = active?.sessionId ?? null;
  const noteGraph = useLineageStore((state) => state.noteGraph);
  const graph = useConversationGraph(sessionId, noteGraph);
  useEffect(() => {
    if (sessionId === null) return;
    return useLineageStore.subscribe((state, previous) => {
      if (
        state.parkedBySession[sessionId]?.leafTurnId !==
        previous.parkedBySession[sessionId]?.leafTurnId
      ) {
        void mutate().catch(noop);
      }
    });
  }, [sessionId, mutate]);
  const conversation = useConversation(
    sessionId,
    data?.seed,
    () => {
      void mutate().catch(noop);
    },
    data?.viewLeafTurnId === undefined || onActiveLineage(data.viewLeafTurnId, graph),
  );
  // The host default moved to another version while this view followed it — an edit from any
  // device, this one included, whose echo folded in as if it continued the old lineage — so the
  // view of the default reads toward it. A parked viewer keeps its version; the chip is its news.
  const parked = useLineageStore((state) =>
    sessionId === null ? undefined : state.parkedBySession[sessionId],
  );
  const userRowIds = conversation.items.flatMap((item) =>
    item.kind === 'message' && item.role === 'user' ? [item.id] : [],
  );
  const leftActiveLineage =
    parked === undefined && graph !== undefined && timelineLeftActiveLineage(userRowIds, graph);
  useEffect(() => {
    if (leftActiveLineage) void mutate().catch(noop);
  }, [leftActiveLineage, mutate]);
  return { conversation, graph };
}
