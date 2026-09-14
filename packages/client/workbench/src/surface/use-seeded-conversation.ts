import type {
  Conversation,
  ConversationProjectionSeed,
  ConversationSeed,
  ConversationSeedSource,
} from '@linkcode/client-core';
import { readConversationSeed, useConversation } from '@linkcode/client-core';
import type { SessionInfo } from '@linkcode/schema';
import type { Options, RequestResult } from '@linkcode/sdk';
import { resolveClient } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useData } from '../runtime/tayori';
import {
  loadPersistedProjection,
  loadPersistedSeed,
  persistProjection,
  persistSeed,
} from './seed-cache';

/** SWR data is `undefined` while loading, so "nothing to seed" needs its own value. */
type SeedData = ConversationProjectionSeed | ConversationSeed | null;

/**
 * Read the seed for a session (see `readConversationSeed`) and persist it for the next reopen.
 * Persisted here, not in an onSuccess hook: the fetcher owns its params, so a session switch
 * mid-flight can't file the snapshot under the newly active session's key.
 */
async function fetchConversationSeed(
  options: Options<ConversationSeedSource>,
): RequestResult<SeedData> {
  const seed = await readConversationSeed(resolveClient(options).raw, options);
  if (seed === undefined) return { data: null };
  if ('items' in seed) persistProjection(options.sessionId, seed);
  else if (options.historyId !== undefined) persistSeed(options.agentKind, options.historyId, seed);
  return { data: seed };
}

/**
 * The active session's conversation view-model, seeded from the daemon: the turn-graph projection
 * where the host serves one, the provider transcript otherwise (the live `agent.event`
 * subscription only covers this connection). The last persisted snapshot serves as
 * `fallbackData` — reopening the app paints history immediately while the fresh read revalidates
 * behind it — and a projection store's resync request is answered by re-running the read.
 */
export function useSeededConversation(
  active: SessionInfo | null,
  onError: (err: unknown) => void,
): Conversation {
  const { data: seed, mutate } = useData(
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
      fallbackData: active
        ? (loadPersistedProjection(active.sessionId) ??
          (active.historyId ? loadPersistedSeed(active.kind, active.historyId) : undefined))
        : undefined,
      // Never opt this into keepPreviousData: a conversation must not bleed across sessions, and
      // on a switch it would serve the previous transcript — forever, with no historyId yet.
    },
  );
  return useConversation(active?.sessionId ?? null, seed ?? undefined, () => {
    void mutate().catch(noop);
  });
}
