import type { AgentEvent, MessageId, SessionId } from '@linkcode/schema';
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

type UserMessageEvent = Extract<AgentEvent, { type: 'user-message' }>;
interface SeedPromptQueue {
  rows: UserMessageEvent[];
  next: number;
}

function takeSeedPrompt(
  rowsByContent: Map<string, SeedPromptQueue>,
  content: UserMessageEvent['content'],
): UserMessageEvent | undefined {
  const key = JSON.stringify(content);
  const queue = rowsByContent.get(key);
  if (!queue) return undefined;
  const row = queue.rows[queue.next];
  queue.next += 1;
  if (queue.next === queue.rows.length) rowsByContent.delete(key);
  return row;
}

/**
 * Whether the seed's transcript snapshot can be assumed to contain this event — the only license
 * the `uptoSeq` cut has to drop it as "already in the snapshot". Providers flush transcripts by
 * whole item, so coverage is checked per provider identity. User prompts are not decided here:
 * their host and provider ids cannot converge, so `sync` folds them through the seed-row alias
 * instead (see {@link createConversationStore}). A chunk of a message the snapshot never saw (the
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
): boolean {
  switch (event.type) {
    case 'agent-message':
    case 'agent-message-chunk':
    case 'agent-thought':
    case 'agent-thought-chunk':
      return seedMessageIds.has(event.messageId);
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
  /** Content key → seed user rows in transcript order plus the next unconsumed index. */
  const seedPromptRows = new Map<string, SeedPromptQueue>();
  /** Host echo id → its consumed seed row; `trusted` = a provenance-checked fresh-run first
   * prompt, the only content bind allowed to drive cursor fills and rewind translation. */
  const promptAliases = new Map<MessageId, { row: UserMessageEvent; trusted: boolean }>();
  /** The transcript's first user row — the only row a fresh run's first prompt can be. */
  let firstUserRowId: MessageId | undefined;
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
          const entry = seedPromptRows.get(key);
          if (entry) entry.rows.push(event);
          else seedPromptRows.set(key, { rows: [event], next: 0 });
          firstUserRowId ??= event.messageId;
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

  /** Fold one prompt echo. A bind grants display dedupe only — never content: an in-cut echo
   * consuming its exact-content seed row is simply not re-folded. A trusted bind's cursor-bearing
   * re-echo re-advances the seed row itself, so the fresh-run cursor lands without the echo ever
   * writing blocks; every other echo folds as its own live item. */
  const advancePrompt = (
    event: UserMessageEvent,
    seq: number,
    cleanBuffer: boolean,
    receivedAt?: number,
  ): void => {
    const alias = promptAliases.get(event.messageId);
    if (alias !== undefined) {
      const { row, trusted } = alias;
      if (trusted && row.branchCursor === undefined && event.branchCursor !== undefined) {
        builder.advance({ ...row, branchCursor: event.branchCursor });
      }
      return;
    }
    if (seq <= uptoSeq) {
      const row = takeSeedPrompt(seedPromptRows, event.content);
      if (row !== undefined) {
        // A bare pre-binding echo alone proves nothing (resume/branch runs retain history behind
        // an async ref window); trust also needs uninterrupted fresh-run provenance and no wipe.
        const trusted =
          cleanBuffer &&
          client.hasFreshSessionProvenance(sessionId) &&
          event.branchCursor === undefined &&
          row.messageId === firstUserRowId;
        promptAliases.set(event.messageId, { row, trusted });
        return;
      }
    }
    builder.advance(event, receivedAt);
  };

  const sync = (): void => {
    if (!seeded) {
      seeded = true;
      if (seed) for (const entry of seed.events) builder.advance(entry.event, entry.ts);
    }
    if (client.eventSeq(sessionId) <= consumedSeq) return;
    const events = client.eventsSnapshot(sessionId);
    // Seq 1 still buffered ⟺ no rewind/stop wiped this connection's view of the session — a gap
    // can hide retained history a bare echo would otherwise pass for a fresh first prompt.
    const cleanBuffer = events[0]?.seq === 1;
    for (let i = firstIndexAfter(events, consumedSeq); i < events.length; i += 1) {
      const { event, seq, receivedAt } = events[i];
      if (event.type === 'user-message') {
        advancePrompt(event, seq, cleanBuffer, receivedAt);
        continue;
      }
      if (event.type === 'conversation-rewind') {
        // Only a trusted bind may aim the destructive cut; an ambiguous one falls through (a
        // missed cut renders stale until the next reseed — never truncates valid turns).
        const alias = promptAliases.get(event.messageId);
        builder.advance(
          alias?.trusted ? { ...event, messageId: alias.row.messageId } : event,
          receivedAt,
        );
        continue;
      }
      if (seq > uptoSeq || !coveredBySeed(event, seedMessageIds, seedToolIds)) {
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
