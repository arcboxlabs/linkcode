import type { AgentEvent, MessageId, RunId, SessionId } from '@linkcode/schema';
import { compareConversationWatermarks } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { JournaledEvent } from '../conversation/live-journal';
import { ConversationLiveJournal, ConversationLiveJournals } from '../conversation/live-journal';

const runId = 'run-journal' as RunId;

function chunk(text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: 'msg-1' as MessageId,
    content: { type: 'text', text },
  };
}

function stamped(epoch: number, seq: number, text = `event-${epoch}-${seq}`): JournaledEvent {
  return { epoch, seq, runId, ts: 1, event: chunk(text) };
}

describe('conversation watermark merge rule', () => {
  it('discards an old-epoch straggler regardless of its seq', () => {
    const watermark = { epoch: 2, seq: 0 };
    // The client merge drops anything ≤ watermark; a delayed old-adapter event can never fold
    // over newer state, however far its own seq ran.
    expect(compareConversationWatermarks({ epoch: 1, seq: 999_999 }, watermark)).toBeLessThan(0);
    expect(compareConversationWatermarks({ epoch: 2, seq: 0 }, watermark)).toBe(0);
    expect(compareConversationWatermarks({ epoch: 2, seq: 1 }, watermark)).toBeGreaterThan(0);
    expect(compareConversationWatermarks({ epoch: 3, seq: 0 }, watermark)).toBeGreaterThan(0);
  });
});

describe('ConversationLiveJournal caps', () => {
  it('holds the byte cap under a chunk storm, accounting exactly for what it retains', () => {
    const maxBytes = 64 * 1024;
    const journal = new ConversationLiveJournal(maxBytes, 100_000);
    const encoder = new TextEncoder();
    for (let seq = 1; seq <= 5000; seq++) {
      journal.append(stamped(1, seq, 'x'.repeat(1024)));
    }
    expect(journal.truncated).toBe(true);
    expect(journal.bytes).toBeLessThanOrEqual(maxBytes);
    // Boundedness of the retained data itself, not just a counter: the accounted bytes equal an
    // independent re-encoding of every retained event.
    const retained = journal
      .snapshot()
      .reduce((sum, { event }) => sum + encoder.encode(JSON.stringify(event)).byteLength, 0);
    expect(journal.bytes).toBe(retained);
    expect(retained).toBeLessThanOrEqual(maxBytes);
  });

  it('holds the event cap under a chunk storm', () => {
    const journal = new ConversationLiveJournal(Number.MAX_SAFE_INTEGER, 100);
    for (let seq = 1; seq <= 10_000; seq++) journal.append(stamped(1, seq));
    expect(journal.size).toBe(100);
    expect(journal.truncated).toBe(true);
    expect(journal.snapshot()[0]?.seq).toBe(9901);
    expect(journal.watermark).toEqual({ epoch: 1, seq: 10_000 });
  });

  it('never marks truncation while under both caps', () => {
    const journal = new ConversationLiveJournal();
    for (let seq = 1; seq <= 50; seq++) journal.append(stamped(1, seq));
    expect(journal.truncated).toBe(false);
    expect(journal.size).toBe(50);
  });
});

describe('ConversationLiveJournal tailAfter', () => {
  it('returns a clean tail for a watermark inside the retained range', () => {
    const journal = new ConversationLiveJournal();
    for (let seq = 1; seq <= 5; seq++) journal.append(stamped(3, seq));

    const { events, gap } = journal.tailAfter({ epoch: 3, seq: 2 });
    expect(gap).toBe(false);
    expect(events.map((event) => event.seq)).toEqual([3, 4, 5]);
  });

  it('reports a gap when eviction removed events past the watermark', () => {
    const journal = new ConversationLiveJournal(Number.MAX_SAFE_INTEGER, 3);
    for (let seq = 1; seq <= 6; seq++) journal.append(stamped(3, seq));

    // seq 1–3 were evicted; a reader at seq 2 lost seq 3 forever — it must re-read, never splice.
    const cut = journal.tailAfter({ epoch: 3, seq: 2 });
    expect(cut.gap).toBe(true);
    expect(cut.events.map((event) => event.seq)).toEqual([4, 5, 6]);

    // A reader at or past everything evicted is complete.
    expect(journal.tailAfter({ epoch: 3, seq: 3 })).toEqual({
      events: journal.snapshot(),
      gap: false,
    });
  });

  it('reports a gap for a watermark from an older epoch: an epoch jump forces a re-read', () => {
    const journal = new ConversationLiveJournal();
    for (let seq = 1; seq <= 3; seq++) journal.append(stamped(7, seq));

    // The old epoch's tail died with its journal; completeness is unprovable below this epoch.
    const jumped = journal.tailAfter({ epoch: 6, seq: 40 });
    expect(jumped.gap).toBe(true);
    expect(jumped.events.map((event) => event.seq)).toEqual([1, 2, 3]);

    // The epoch's own base is complete: everything since the journal was born is retained.
    expect(journal.tailAfter({ epoch: 7, seq: 0 }).gap).toBe(false);
  });

  it('keeps the watermark at the lexicographic max when an old-epoch straggler appends late', () => {
    const journal = new ConversationLiveJournal();
    journal.append(stamped(2, 1));
    journal.append(stamped(2, 2));
    journal.append(stamped(1, 99));

    expect(journal.watermark).toEqual({ epoch: 2, seq: 2 });
    // The straggler sits at or below every current-epoch watermark — provably discarded on read.
    expect(journal.tailAfter({ epoch: 2, seq: 2 }).events).toEqual([]);
  });
});

describe('ConversationLiveJournals registry', () => {
  it('creates one journal per session and drops it with the live session', () => {
    const journals = new ConversationLiveJournals();
    const sessionId = 'sess-journal' as SessionId;
    const journal = journals.open(sessionId);
    journal.append(stamped(1, 1));
    expect(journals.open(sessionId)).toBe(journal);
    expect(journals.get(sessionId)?.size).toBe(1);

    journals.drop(sessionId);
    expect(journals.get(sessionId)).toBeUndefined();
    expect(journals.open(sessionId).size).toBe(0);
  });
});
