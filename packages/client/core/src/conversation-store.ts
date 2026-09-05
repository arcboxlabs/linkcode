import type { AgentEvent, ConversationWatermark, SessionId } from '@linkcode/schema';
import { compareConversationWatermarks, userRowMessageId } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxact/noop';
import type { ConversationGraphChange, LinkCodeClient, SequencedAgentEvent } from './client';
import type { Conversation, ConversationBuilder, ConversationSeed } from './conversation';
import { createConversationBuilder } from './conversation';
import type { ConversationProjectionSeed } from './conversation-read';

/** A `useSyncExternalStore`-shaped incremental projection of one session's conversation.
 * Function-typed properties (not methods): both get detached and handed to React. */
export interface ConversationStore {
  subscribe: (onStoreChange: () => void) => Unsubscribe;
  getSnapshot: () => Conversation;
}

/** Why a projection store wants its seed re-read: the live stream can no longer be trusted to
 * extend the read it was folded onto. */
export type ConversationResyncReason = 'epoch' | 'gap' | 'graph';

export interface ConversationStoreOptions {
  /** Called at most once per store, never during a render, when the seed must be re-read. */
  onResync?: (reason: ConversationResyncReason) => void;
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
 * Project a session's conversation from a seed plus the live event buffer. A projection seed (a
 * `conversation.read` walk) merges by the daemon's `(epoch, seq)` positions; a history seed (a
 * `history.read` transcript, the path for ≤v79 daemons and sessions without a turn graph) merges
 * by the connection's receive cut. Either way the sync is idempotent and monotone with a stable
 * snapshot identity between events — the `useSyncExternalStore` getSnapshot contract. A store is
 * bound to one (session, seed) pair; create a fresh one when either changes.
 */
export function createConversationStore(
  client: LinkCodeClient,
  sessionId: SessionId | null,
  seed?: ConversationSeed | ConversationProjectionSeed,
  options: ConversationStoreOptions = {},
): ConversationStore {
  if (!sessionId) {
    return { subscribe: () => noop, getSnapshot: () => EMPTY_CONVERSATION };
  }
  if (seed !== undefined && 'items' in seed) {
    return createProjectionStore(client, sessionId, seed, options.onResync ?? noop);
  }
  return createHistoryStore(client, sessionId, seed, options.onResync ?? noop);
}

/** Kinds the projection merge never drops on the watermark: their authoritative state lives in
 * the daemon's interaction registry, a read may predate them, and the builder folds repeats
 * idempotently — so the backstop that keeps a permission card renderable costs nothing. */
const INTERACTIVE_EVENT_TYPES = new Set<AgentEvent['type']>([
  'permission-request',
  'question-request',
  'permission-resolved',
  'question-resolved',
  'prompt-response-status',
]);

/**
 * The projection merge: the seed's items fold first, then every live event whose position is
 * above the seed's watermark. Nothing is matched by content — the daemon mints one identity per
 * user row for the echo and the read alike, so re-reads converge on the rows they already hold.
 * A position that skips ahead (a sequence gap, an epoch jump) or a graph revision past the read
 * asks the owner to re-read once; folding continues meanwhile so streaming never stalls.
 */
function createProjectionStore(
  client: LinkCodeClient,
  sessionId: SessionId,
  seed: ConversationProjectionSeed,
  onResync: (reason: ConversationResyncReason) => void,
): ConversationStore {
  const builder = createConversationBuilder();
  const userMessageIds = new Set<string>();
  let seeded = false;
  /** Highest receive seq already examined. */
  let consumedSeq = 0;
  /** The newest daemon position covered or folded; a persisted seed starts with none and the first
   * stamped event becomes the baseline. */
  let cursor: ConversationWatermark | null = seed.watermark ?? null;
  let resyncRequested = false;

  const requestResync = (reason: ConversationResyncReason): void => {
    if (resyncRequested) return;
    resyncRequested = true;
    // Detection runs inside getSnapshot (a render); the owner's re-read must not.
    queueMicrotask(() => onResync(reason));
  };

  const fold = (event: AgentEvent, receivedAt: number | undefined): void => {
    if (event.type === 'user-message') userMessageIds.add(event.messageId);
    builder.advance(event, receivedAt);
  };

  const foldSeed = (): void => {
    for (let i = 0, len = seed.items.length; i < len; i++) {
      const item = seed.items[i];
      if (!('event' in item)) {
        builder.unavailable();
        continue;
      }
      fold(item.event, item.ts);
    }
  };

  /** Whether a live entry extends the seed; advances the cursor and flags gaps and jumps. */
  const admit = (entry: SequencedAgentEvent): boolean => {
    const { position } = entry;
    if (position === undefined) return true;
    if (cursor !== null) {
      // Covered by the read, or an older epoch's straggler: gone either way.
      if (compareConversationWatermarks(position, cursor) <= 0) {
        return INTERACTIVE_EVENT_TYPES.has(entry.event.type);
      }
      if (position.epoch !== cursor.epoch) requestResync('epoch');
      else if (position.seq !== cursor.seq + 1) requestResync('gap');
    }
    cursor = position;
    return true;
  };

  const sync = (): void => {
    if (!seeded) {
      seeded = true;
      foldSeed();
    }
    if (client.eventSeq(sessionId) <= consumedSeq) return;
    const events = client.eventsSnapshot(sessionId);
    for (let i = firstIndexAfter(events, consumedSeq), len = events.length; i < len; i += 1) {
      const entry = events[i];
      if (admit(entry)) fold(entry.event, entry.receivedAt);
    }
    consumedSeq = client.eventSeq(sessionId);
  };

  /** A revision past this read means a lineage moved. A plain continuation is already covered
   * live — its new leaf's own user row has arrived — so only a leaf this store has never seen
   * (an edit or rewrite from any device, a stale read) needs the re-read. */
  const checkGraph = (change: ConversationGraphChange | undefined): void => {
    if (change === undefined || change.graphRevision <= seed.graphRevision) return;
    if (
      change.activeLeafTurnId !== undefined &&
      userMessageIds.has(userRowMessageId(change.activeLeafTurnId))
    ) {
      return;
    }
    requestResync('graph');
  };

  return {
    subscribe(onStoreChange) {
      sync();
      checkGraph(client.latestGraphChange(sessionId));
      const unsubscribeEvents = client.subscribe(sessionId, () => {
        sync();
        onStoreChange();
      });
      const unsubscribeGraph = client.subscribeGraphChanges(sessionId, (change) => {
        sync();
        checkGraph(change);
      });
      return () => {
        unsubscribeEvents();
        unsubscribeGraph();
      };
    },
    getSnapshot() {
      sync();
      return builder.snapshot();
    },
  };
}

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
 * The transcript merge for hosts without a turn graph: the seed folds once, then `getSnapshot`
 * lazily advances by unconsumed events, skipping events inside the `uptoSeq` cut that the snapshot
 * verifiably covers (see {@link foldPreCutEvent}). Provider and host ids never converge here, so
 * user rows are matched by content — the path retires with the compatibility floor.
 */
function createHistoryStore(
  client: LinkCodeClient,
  sessionId: SessionId,
  seed: ConversationSeed | undefined,
  onResync: (reason: ConversationResyncReason) => void,
): ConversationStore {
  const builder = createConversationBuilder();
  const uptoSeq = seed?.uptoSeq ?? 0;
  // Identities the snapshot actually holds, for the per-event coverage check of the cut.
  const seedMessageIds = new Set<string>();
  const seedToolIds = new Set<string>();
  const seedUserMessages = new Map<string, SeedUserMessageQueue>();
  if (seed) {
    for (let i = 0, len = seed.events.length; i < len; i++) {
      const { event } = seed.events[i];
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
  let resyncRequested = false;

  const requestResync = (): void => {
    if (resyncRequested) return;
    resyncRequested = true;
    queueMicrotask(() => onResync('graph'));
  };

  const noteGraph = (change: ConversationGraphChange | undefined): void => {
    // A leaf appearing after an empty-graph / live-only read is the cutover: the owner must
    // re-read so the next store is a projection. History-path sessions never see this.
    if (change?.activeLeafTurnId !== undefined) requestResync();
  };

  const sync = (): void => {
    if (!seeded) {
      seeded = true;
      if (seed) {
        for (let i = 0, len = seed.events.length; i < len; i++) {
          const entry = seed.events[i];
          builder.advance(entry.event, entry.ts);
        }
      }
    }
    if (client.eventSeq(sessionId) <= consumedSeq) return;
    const events = client.eventsSnapshot(sessionId);
    for (let i = firstIndexAfter(events, consumedSeq), len = events.length; i < len; i += 1) {
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
    subscribe(onStoreChange) {
      noteGraph(client.latestGraphChange(sessionId));
      const unsubscribeEvents = client.subscribe(sessionId, onStoreChange);
      const unsubscribeGraph = client.subscribeGraphChanges(sessionId, (change) => {
        noteGraph(change);
      });
      return () => {
        unsubscribeEvents();
        unsubscribeGraph();
      };
    },
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
