import type { SessionId } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxact/noop';
import type { LinkCodeClient, SequencedAgentEvent } from './client';
import type { Conversation, ConversationSeed } from './conversation';
import { createConversationBuilder } from './conversation';

/** A `useSyncExternalStore`-shaped incremental projection of one session's conversation.
 * Function-typed properties (not methods): both get detached and handed to React. */
export interface ConversationStore {
  subscribe: (onStoreChange: () => void) => Unsubscribe;
  getSnapshot: () => Conversation;
}

const EMPTY_CONVERSATION: Conversation = {
  items: [],
  status: null,
  usage: null,
  currentModeId: null,
  stopReason: null,
  pendingPermissionIds: [],
};

/**
 * Project a session's conversation from a transcript seed plus the live event buffer. The seed is
 * folded once, then each `getSnapshot` lazily advances the builder by the newly received events
 * only (receive seq > the seed's `uptoSeq` cut) — O(delta) per event instead of re-reducing the
 * whole history. The lazy sync is idempotent and monotone, so repeated render-time calls
 * (StrictMode, interrupted renders) are safe, and the snapshot keeps a stable identity between
 * events — the `useSyncExternalStore` getSnapshot contract.
 *
 * A store instance is bound to one (session, seed) pair; create a fresh one when either changes.
 */
export function createConversationStore(
  client: LinkCodeClient,
  sessionId: SessionId | null,
  seed?: ConversationSeed,
): ConversationStore {
  if (!sessionId) {
    return { subscribe: () => noop, getSnapshot: () => EMPTY_CONVERSATION };
  }

  const builder = createConversationBuilder();
  let seeded = false;
  let consumedSeq = seed?.uptoSeq ?? 0;

  const sync = (): void => {
    if (!seeded) {
      seeded = true;
      if (seed) for (const event of seed.events) builder.advance(event);
    }
    if (client.eventSeq(sessionId) <= consumedSeq) return;
    const events = client.eventsSnapshot(sessionId);
    for (let i = firstIndexAfter(events, consumedSeq); i < events.length; i += 1) {
      builder.advance(events[i].event);
    }
    // Snap to the counter even when the buffer lags it (cleared by a stop): those events are
    // gone from the buffer and covered by transcripts, so there is nothing left to consume.
    consumedSeq = client.eventSeq(sessionId);
  };

  return {
    subscribe: (onStoreChange) => client.subscribe(sessionId, onStoreChange),
    getSnapshot() {
      sync();
      return builder.snapshot();
    },
  };
}

/** First index whose receive seq is strictly after the cut (seqs are ascending in the buffer). */
function firstIndexAfter(events: readonly SequencedAgentEvent[], seq: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].seq > seq) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
