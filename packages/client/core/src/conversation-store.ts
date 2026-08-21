import type { AgentEvent, SessionId } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxact/noop';
import type { LinkCodeClient, SequencedAgentEvent } from './client';
import type { Conversation, ConversationBuilder, ConversationSeed } from './conversation';
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

type UserMessageEvent = Extract<AgentEvent, { type: 'user-message' }>;
interface SeedUserMessageQueue {
  messages: UserMessageEvent[];
  nextIndex: number;
}

function takeSeedUserMessage(
  messagesByContent: Map<string, SeedUserMessageQueue>,
  content: UserMessageEvent['content'],
): UserMessageEvent | undefined {
  const key = JSON.stringify(content);
  const queue = messagesByContent.get(key);
  if (!queue) return undefined;
  const message = queue.messages[queue.nextIndex];
  queue.nextIndex += 1;
  if (queue.nextIndex === queue.messages.length) messagesByContent.delete(key);
  return message;
}

/** Fold a pre-cut event only when the transcript snapshot does not already cover it. */
function foldPreCutEvent(
  builder: ConversationBuilder,
  event: AgentEvent,
  receivedAt: number | undefined,
  seedMessageIds: ReadonlySet<string>,
  seedToolIds: ReadonlySet<string>,
  seedUserMessages: Map<string, SeedUserMessageQueue>,
): void {
  switch (event.type) {
    case 'agent-message':
    case 'agent-message-chunk':
    case 'agent-thought':
    case 'agent-thought-chunk': {
      if (!seedMessageIds.has(event.messageId)) builder.advance(event, receivedAt);
      break;
    }
    case 'user-message': {
      // Host and provider ids cannot converge, so consume matching seed rows by value. Some
      // histories omit images; use the full live echo to enrich that seed row in place.
      if (takeSeedUserMessage(seedUserMessages, event.content)) break;
      if (event.content.some((block) => block.type === 'image')) {
        const seedMessage = takeSeedUserMessage(
          seedUserMessages,
          event.content.filter((block) => block.type !== 'image'),
        );
        if (seedMessage) {
          builder.advance({
            ...event,
            messageId: seedMessage.messageId,
            branchCursor: seedMessage.branchCursor,
          });
          break;
        }
      }
      builder.advance(event, receivedAt);
      break;
    }
    case 'tool-call': {
      if (!seedToolIds.has(event.toolCall.toolCallId)) builder.advance(event, receivedAt);
      break;
    }
    case 'tool-call-content-chunk': {
      if (!seedToolIds.has(event.toolCallId)) builder.advance(event, receivedAt);
      break;
    }
    default:
      builder.advance(event, receivedAt);
  }
}

/**
 * Project a session's conversation from a transcript seed plus the live event buffer: the seed
 * folds once, then `getSnapshot` lazily advances by unconsumed events, skipping events inside the
 * `uptoSeq` cut that the snapshot verifiably covers (see {@link foldPreCutEvent}). The sync is idempotent and monotone with a stable snapshot identity
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
  const seedUserMessages = new Map<string, SeedUserMessageQueue>();
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
          const queue = seedUserMessages.get(key);
          if (queue) queue.messages.push(event);
          else seedUserMessages.set(key, { messages: [event], nextIndex: 0 });
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
      if (seq > uptoSeq) {
        builder.advance(event, receivedAt);
      } else {
        foldPreCutEvent(builder, event, receivedAt, seedMessageIds, seedToolIds, seedUserMessages);
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
