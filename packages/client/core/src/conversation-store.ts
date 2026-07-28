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
  availableModels: null,
  capabilities: null,
  stopReason: null,
  pendingPermissionIds: [],
  pendingQuestionIds: [],
};

/**
 * Whether the seed's transcript snapshot can be assumed to contain this event — the only license
 * the `uptoSeq` cut has to drop it as "already in the snapshot". Providers flush transcripts by
 * whole item, so coverage is checked per provider identity, or by counted value for user prompts
 * whose host and provider ids cannot converge. A chunk of a message the snapshot never saw (the
 * in-flight reply — claude-code writes the row only when the message completes) must survive a
 * mid-turn reseed, or the streamed text vanishes at a chunk boundary (CODE-272). Everything
 * outside the switch (interactive requests and resolutions, status, stop, errors, usage …) is
 * ephemeral: it never appears in `history.read`, so cutting it would erase it outright — a pending
 * permission-request would vanish and strand the turn (CODE-35).
 */
function coveredBySeed(
  event: AgentEvent,
  seedMessageIds: ReadonlySet<string>,
  seedToolIds: ReadonlySet<string>,
  seedUserMessageCounts: Map<string, number>,
): boolean {
  switch (event.type) {
    case 'agent-message':
    case 'agent-message-chunk':
    case 'agent-thought':
    case 'agent-thought-chunk':
      return seedMessageIds.has(event.messageId);
    case 'user-message': {
      // Host and provider ids cannot converge, so consume one matching seed row by value. Counting
      // preserves repeated prompts while an unflushed queued prompt remains visible past the cut.
      const key = JSON.stringify(event.content);
      const remaining = seedUserMessageCounts.get(key) ?? 0;
      if (remaining === 0) return false;
      if (remaining === 1) seedUserMessageCounts.delete(key);
      else seedUserMessageCounts.set(key, remaining - 1);
      return true;
    }
    case 'tool-call':
      return seedToolIds.has(event.toolCall.toolCallId);
    case 'tool-call-content-chunk':
      return seedToolIds.has(event.toolCallId);
    default:
      return false;
  }
}

/**
 * Project a session's conversation from a transcript seed plus the live event buffer: the seed
 * folds once, then `getSnapshot` lazily advances by unconsumed events, skipping events inside the
 * `uptoSeq` cut that the snapshot verifiably covers (see {@link coveredBySeed}). The sync is idempotent and monotone with a stable snapshot identity
 * between events — the `useSyncExternalStore` getSnapshot contract. A store is bound to one
 * (session, seed) pair; create a fresh one when either changes.
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
  // Identities the snapshot actually holds, for the per-event coverage check of the cut.
  const seedMessageIds = new Set<string>();
  const seedToolIds = new Set<string>();
  const seedUserMessageCounts = new Map<string, number>();
  if (seed) {
    for (const { event } of seed.events) {
      switch (event.type) {
        case 'agent-message':
        case 'agent-message-chunk':
        case 'agent-thought':
        case 'agent-thought-chunk':
          seedMessageIds.add(event.messageId);
          break;
        case 'user-message': {
          const key = JSON.stringify(event.content);
          seedUserMessageCounts.set(key, (seedUserMessageCounts.get(key) ?? 0) + 1);
          break;
        }
        case 'tool-call':
          seedToolIds.add(event.toolCall.toolCallId);
          break;
        case 'tool-call-content-chunk':
          seedToolIds.add(event.toolCallId);
          break;
        default:
          break;
      }
    }
  }
  let seeded = false;
  /** Highest receive seq already examined (not necessarily folded — covered ones may be cut). */
  let consumedSeq = 0;

  const sync = (): void => {
    if (!seeded) {
      seeded = true;
      if (seed) for (const entry of seed.events) builder.advance(entry.event, entry.ts);
    }
    if (client.eventSeq(sessionId) <= consumedSeq) return;
    const events = client.eventsSnapshot(sessionId);
    for (let i = firstIndexAfter(events, consumedSeq); i < events.length; i += 1) {
      const { event, seq, receivedAt } = events[i];
      if (
        seq > uptoSeq ||
        !coveredBySeed(event, seedMessageIds, seedToolIds, seedUserMessageCounts)
      ) {
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
