import type {
  AgentEvent,
  ConversationReadItem,
  MessageId,
  RunId,
  SessionId,
  SessionRecord,
  TurnId,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import type { JournaledEvent } from '../conversation/live-journal';
import { ConversationLiveJournals } from '../conversation/live-journal';
import { ConversationProjectionService, pageReadItems } from '../conversation/projection-service';
import { ConversationTurnService } from '../conversation/turn-service';
import { HistoryService } from '../session/history-service';
import { SessionRecordRegistry } from '../session/session-record-registry';
import { InMemorySessionStore } from '../session/session-store';
import { FakeAdapter } from './fixtures/session-harness';

const sessionId = 'sess-projection' as SessionId;
const runId = 'run-1' as RunId;

const OPEN_ASK: AgentEvent = {
  type: 'permission-request',
  requestId: 'perm-open',
  title: 'Run',
  subject: { type: 'tool-call', toolCallId: 't1' },
  options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
};

function chunk(messageId: string, text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text },
  };
}

function stamped(seq: number, turnId: TurnId, event: AgentEvent): JournaledEvent {
  return { epoch: 3, seq, runId, turnId, ts: 1000 + seq, event };
}

async function makeService(opts: {
  journals: ConversationLiveJournals;
  record: SessionRecord;
  openRequests?: AgentEvent[];
}) {
  const runTask = (effect: Effect.Effect<void>) => {
    void Effect.runPromise(effect);
  };
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send: noop,
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  const records = new SessionRecordRegistry(new InMemorySessionStore(), noop);
  await Effect.runPromise(records.start(runTask));
  records.register(opts.record);
  const store = new InMemoryConversationStore();
  const turns = new ConversationTurnService(store, records, transport, runTask);
  const history = new HistoryService(() => new FakeAdapter());
  const service = new ConversationProjectionService(
    turns,
    records,
    history,
    opts.journals,
    () => opts.openRequests ?? [],
  );
  return { service, store };
}

function makeRecord(activeLeafTurnId: TurnId): SessionRecord {
  return {
    sessionId,
    kind: 'claude-code',
    cwd: '/repo',
    origin: { type: 'created' },
    createdAt: 1,
    updatedAt: 1,
    runs: [{ runId, startedAt: 1 }],
    activeLeafTurnId,
    graphRevision: 1,
    eventEpoch: 3,
  };
}

describe('conversation projection live tail (CODE-35)', () => {
  it('clears a truncated in-flight stream and still delivers open asks', async () => {
    const liveTurnId = 'turn-live' as TurnId;
    const journals = new ConversationLiveJournals(Number.MAX_SAFE_INTEGER, 3);
    const journal = journals.open(sessionId);
    journal.append(stamped(1, liveTurnId, chunk('msg-a', 'head ')));
    journal.append(stamped(2, liveTurnId, chunk('msg-a', 'lost ')));
    journal.append(
      stamped(3, liveTurnId, {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Run tests',
          kind: 'execute',
          status: 'completed',
          content: [],
        },
      }),
    );
    journal.append(stamped(4, liveTurnId, chunk('msg-b', 'fresh ')));
    journal.append(stamped(5, liveTurnId, chunk('msg-b', 'tail')));

    const { service, store } = await makeService({
      journals,
      record: makeRecord(liveTurnId),
      openRequests: [OPEN_ASK],
    });
    await store.saveTurn({
      turnId: liveTurnId,
      sessionId,
      parentTurnId: null,
      siblingOrdinal: 1,
      input: { type: 'shell-command', command: 'pnpm test' },
      runId,
      state: 'running',
      createdAt: 10,
    });

    const result = await Effect.runPromise(service.read({ sessionId }));

    expect(result.cursor).toBeUndefined();
    expect(result.watermark).toEqual({ epoch: 3, seq: 5 });
    const tailEvents = result.events.flatMap((item) => ('event' in item ? [item.event] : []));
    // The msg-a stream lost its head to eviction: no headless splice, the message restarts.
    expect(tailEvents.filter((e) => e.type === 'agent-message-chunk')).toEqual([
      chunk('msg-b', 'fresh '),
      chunk('msg-b', 'tail'),
    ]);
    expect(tailEvents).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolCall: expect.anything() }),
    );
    // The open ask reaches the reader even though its request event never survived the journal.
    const ask = result.events.find((item) => 'event' in item && item.event === OPEN_ASK);
    expect(ask).toMatchObject({ turnId: liveTurnId, runId });
  });

  it('cuts the tail at the last event of a settled path turn', async () => {
    const doneTurnId = 'turn-done' as TurnId;
    const liveTurnId = 'turn-live' as TurnId;
    const journals = new ConversationLiveJournals();
    const journal = journals.open(sessionId);
    journal.append(
      stamped(1, doneTurnId, {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't0',
          title: 'Old work',
          kind: 'execute',
          status: 'completed',
          content: [],
        },
      }),
    );
    journal.append(stamped(2, doneTurnId, { type: 'stop', stopReason: 'end_turn' }));
    journal.append(stamped(3, liveTurnId, chunk('msg-live', 'streaming')));

    const { service, store } = await makeService({ journals, record: makeRecord(liveTurnId) });
    await store.saveTurn({
      turnId: doneTurnId,
      sessionId,
      parentTurnId: null,
      siblingOrdinal: 1,
      input: { type: 'shell-command', command: 'ls' },
      runId,
      state: 'completed',
      createdAt: 5,
    });
    await store.saveTurn({
      turnId: liveTurnId,
      sessionId,
      parentTurnId: doneTurnId,
      siblingOrdinal: 1,
      input: { type: 'shell-command', command: 'pwd' },
      runId,
      state: 'running',
      createdAt: 10,
    });

    const result = await Effect.runPromise(service.read({ sessionId }));

    // Settled-turn journal events fall below the cut: durable sources own that turn (here the
    // no-history placeholder), so only the live turn's stream rides the tail.
    const stamps = result.events.flatMap((item) =>
      'event' in item && item.seq !== undefined ? [item.seq] : [],
    );
    expect(stamps).toEqual([3]);
    expect(result.events).toContainEqual({
      type: 'history-unavailable',
      turnId: doneTurnId,
      runId,
    });
    expect(result.watermark).toEqual({ epoch: 3, seq: 3 });
  });
});

describe('pageReadItems byte budget', () => {
  function textItem(turnId: string, text: string): ConversationReadItem {
    return {
      turnId: turnId as TurnId,
      event: {
        type: 'user-message',
        messageId: `msg-${turnId}` as MessageId,
        content: [{ type: 'text', text }],
      },
    };
  }

  function bytes(item: ConversationReadItem): number {
    return Buffer.byteLength(JSON.stringify(item), 'utf8');
  }

  it('splits durable items at the budget and never stalls on one oversized item', () => {
    const items = [textItem('t1', 'x'.repeat(400)), textItem('t2', 'y'.repeat(400))];
    const budget = bytes(items[0]) + 10;

    const first = pageReadItems(items, [], 0, 1000, budget);
    expect(first.events).toEqual([items[0]]);
    expect(first.cursor).toBe('1');

    const second = pageReadItems(items, [], 1, 1000, budget);
    expect(second.events).toEqual([items[1]]);
    expect(second.cursor).toBeUndefined();

    // An item alone above the budget still ships as its own page.
    const oversized = pageReadItems([textItem('t3', 'z'.repeat(4000))], [], 0, 1000, budget);
    expect(oversized.events).toHaveLength(1);
    expect(oversized.cursor).toBeUndefined();
  });

  it('keeps the live tail atomic to the final page', () => {
    const durable = [textItem('t1', 'x'.repeat(100))];
    const tail = [textItem('live', 'w'.repeat(300))];
    const budget = bytes(durable[0]) + 10;

    // The tail does not fit next to the durable remainder: it gets its own final page.
    const first = pageReadItems(durable, tail, 0, 1000, budget);
    expect(first.events).toEqual(durable);
    expect(first.cursor).toBe('1');

    const last = pageReadItems(durable, tail, 1, 1000, budget);
    expect(last.events).toEqual(tail);
    expect(last.cursor).toBeUndefined();
  });

  it('trims an oversized tail from the front and clears the damaged stream', () => {
    const bigChunk: ConversationReadItem = {
      event: chunk('msg-big', 'x'.repeat(500)),
    };
    const laterChunk: ConversationReadItem = { event: chunk('msg-big', 'tail piece') };
    const otherChunk: ConversationReadItem = { event: chunk('msg-ok', 'intact') };
    const budget = bytes(bigChunk) + bytes(otherChunk) + bytes(laterChunk) - 1;

    const page = pageReadItems([], [bigChunk, laterChunk, otherChunk], 0, 1000, budget);
    // Dropping the stream head drops its retained continuation too — never a headless splice.
    expect(page.events).toEqual([otherChunk]);
    expect(page.cursor).toBeUndefined();
  });
});
