import type { ConversationGraphSnapshot } from '@linkcode/client-core';
import type { SessionId } from '@linkcode/schema';
import type { Options, RequestResult } from '@linkcode/sdk';
import { resolveClient } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useEffect } from 'react';
import { useWorkbenchSdkClient } from '../runtime/provider';
import { useData } from '../runtime/tayori';
import { useLineageStore } from './lineage-store';

async function fetchConversationGraph(
  options: Options<{ sessionId: SessionId }>,
): RequestResult<ConversationGraphSnapshot> {
  return { data: await resolveClient(options).raw.getConversationGraph(options.sessionId) };
}

/**
 * The session's turn tree — ids, parents, ordinals, states — revalidated on every
 * `conversation.graph.changed`. Undefined before the first read and on hosts without a graph.
 * `onSnapshot` runs per fresh snapshot for event-time bookkeeping (a parked view that the host
 * default caught up with), never during render.
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
    const revalidate = (): void => {
      void mutate().catch(noop);
    };
    const unsubscribeChanges = client.subscribeGraphChanges(sessionId, revalidate);
    // Parking at a just-submitted turn must see it in the tree before any `graph.changed` lands:
    // its state decides whether the view follows the live stream.
    const unsubscribeParked = useLineageStore.subscribe((state, previous) => {
      if (state.parkedBySession[sessionId] !== previous.parkedBySession[sessionId]) revalidate();
    });
    return () => {
      unsubscribeChanges();
      unsubscribeParked();
    };
  }, [client, enabled, sessionId, mutate]);
  return data;
}
