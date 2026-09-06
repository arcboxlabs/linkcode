import type { ConversationGraphSnapshot } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';
import type { Options, RequestResult } from '@linkcode/sdk';
import { resolveClient } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useEffect } from 'react';
import { useWorkbenchSdkClient } from '../runtime/provider';
import { useData } from '../runtime/tayori';

async function fetchConversationGraph(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<ConversationGraphSnapshot> {
  return { data: await resolveClient(options).raw.getConversationGraph(options.sessionId) };
}

/**
 * The session's turn tree — ids, parents, ordinals, states — revalidated on every
 * `conversation.graph.changed` (a settle re-announces at the same revision, so the badges follow).
 * Undefined before the first read and on hosts without a graph. `onSnapshot` runs per fresh
 * snapshot for event-time bookkeeping (a parked view that the host default caught up with), never
 * during render.
 */
export function useConversationGraph(
  sessionId: SessionId | null,
  onSnapshot?: (snapshot: ConversationGraphSnapshot) => void,
): ConversationGraphSnapshot | undefined {
  const client = useWorkbenchSdkClient().raw;
  const enabled = sessionId !== null && client.supportsConversationGraph;
  const { data, mutate } = useData(fetchConversationGraph, enabled ? { sessionId } : null, {
    onSuccess: onSnapshot,
  });
  useEffect(() => {
    if (!enabled) return;
    return client.subscribeGraphChanges(sessionId, () => {
      void mutate().catch(noop);
    });
  }, [client, enabled, sessionId, mutate]);
  return data;
}
