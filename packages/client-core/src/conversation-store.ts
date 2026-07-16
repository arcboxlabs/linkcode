import type { AgentEvent, SessionId } from '@linkcode/schema';
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
  usageReport: null,
  currentModeId: null,
  approvalPolicy: null,
  currentModel: null,
  currentEffort: null,
  availableCommands: null,
  capabilities: null,
  stopReason: null,
  pendingPermissionIds: [],
  pendingQuestionIds: [],
};

/**
 * Event types a provider-transcript read can reproduce — the only ones the `uptoSeq` cut may drop
 * as "already in the snapshot". Everything else (permission asks, status, stop, errors, usage …)
 * is ephemeral: it never appears in `history.read`, so cutting it would erase it outright — a
 * pending permission-request would vanish from the timeline and strand the turn un-answerable
 * (CODE-35).
 */
const SEEDABLE_EVENT_TYPES = new Set<AgentEvent['type']>([
  'user-message',
  'agent-message-chunk',
  'agent-thought-chunk',
  'tool-call',
]);

/**
 * Project a session's conversation from a transcript seed plus the live event buffer. The seed is
 * folded once, then each `getSnapshot` lazily advances the builder by the not-yet-consumed events:
 * seedable events inside the `uptoSeq` cut are skipped (the snapshot already contains them),
 * ephemeral events always fold — O(delta) per event instead of re-reducing the whole history. The
 * lazy sync is idempotent and monotone, so repeated render-time calls (StrictMode, interrupted
 * renders) are safe, and the snapshot keeps a stable identity between events — the
 * `useSyncExternalStore` getSnapshot contract.
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
  const uptoSeq = seed?.uptoSeq ?? 0;
  let seeded = false;
  /** Highest receive seq already examined (not necessarily folded — seedable ones may be cut). */
  let consumedSeq = 0;

  const sync = (): void => {
    if (!seeded) {
      seeded = true;
      if (seed) for (const event of seed.events) builder.advance(event);
    }
    if (client.eventSeq(sessionId) <= consumedSeq) return;
    const events = client.eventsSnapshot(sessionId);
    for (let i = firstIndexAfter(events, consumedSeq); i < events.length; i += 1) {
      const { event, seq, receivedAt } = events[i];
      if (seq > uptoSeq || !SEEDABLE_EVENT_TYPES.has(event.type)) {
        builder.advance(event, receivedAt);
      }
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
