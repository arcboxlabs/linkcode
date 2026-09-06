import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryEvent,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  ConversationReadItem,
  ConversationTurnState,
  MessageId,
  RunId,
  SessionId,
  SessionRecord,
  TurnId,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Cause, Effect, Exit } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { ConversationCheckpointService } from '../conversation/checkpoint-service';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import type { JournaledEvent } from '../conversation/live-journal';
import { ConversationLiveJournals } from '../conversation/live-journal';
import { ConversationProjectionService, pageReadItems } from '../conversation/projection-service';
import { ConversationTurnService } from '../conversation/turn-service';
import { RequestError } from '../failure';
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

class CannedHistoryAdapter extends FakeAdapter {
  constructor(private readonly eventsFor: (historyId: string) => AgentHistoryEvent[]) {
    super();
  }

  override readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    return Promise.resolve({
      session: { historyId: opts.historyId, kind: this.kind, cwd: '/repo', createdAt: 1 },
      events: [...this.eventsFor(opts.historyId)],
    });
  }
}

async function makeService(opts: {
  journals: ConversationLiveJournals;
  record: SessionRecord;
  openRequests?: AgentEvent[];
  /** One corpus for every history id. */
  historyEvents?: AgentHistoryEvent[];
  /** A corpus per history id — forked lineages read different histories. */
  historiesById?: Record<string, AgentHistoryEvent[]>;
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
  const { historyEvents, historiesById } = opts;
  const history = new HistoryService(() =>
    historyEvents || historiesById
      ? new CannedHistoryAdapter((historyId) => historiesById?.[historyId] ?? historyEvents ?? [])
      : new FakeAdapter(),
  );
  const service = new ConversationProjectionService(
    turns,
    records,
    new ConversationCheckpointService(turns, records, history),
    opts.journals,
    () => opts.openRequests ?? [],
  );
  return { service, store };
}

function makeRecord(activeLeafTurnId: TurnId, withHistory = false): SessionRecord {
  return {
    sessionId,
    kind: 'claude-code',
    cwd: '/repo',
    origin: { type: 'created' },
    createdAt: 1,
    updatedAt: 1,
    runs: [{ runId, startedAt: 1, ...(withHistory && { historyId: asHistoryId('hist-1') }) }],
    activeLeafTurnId,
    graphRevision: 1,
    eventEpoch: 3,
  };
}

describe('conversation projection live tail (CODE-35)', () => {
  it('clears a truncated in-flight stream and still delivers open asks', async () => {
    const liveTurnId = 'turn-live' as TurnId;
    const journals = new ConversationLiveJournals(Number.MAX_SAFE_INTEGER, 4);
    const journal = journals.open(sessionId);
    journal.append(stamped(1, liveTurnId, chunk('msg-a', 'head ')));
    journal.append(stamped(2, liveTurnId, chunk('msg-a', 'mid ')));
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
    // msg-a lost its head (seq 1 evicted) but seq 2 survived: the RETAINED continuation must be
    // dropped too — no headless splice, the message restarts.
    expect(tailEvents.filter((e) => e.type === 'agent-message-chunk')).toEqual([
      chunk('msg-b', 'fresh '),
      chunk('msg-b', 'tail'),
    ]);
    expect(tailEvents).toContainEqual(
      expect.objectContaining({ type: 'tool-call', toolCall: expect.anything() }),
    );
    // Eviction reached the live turn's region: the read must not claim its content is complete.
    expect(result.events).toContainEqual({
      type: 'history-unavailable',
      turnId: liveTurnId,
      runId,
    });
    // The open ask reaches the reader even though its request event never survived the journal.
    const ask = result.events.find((item) => 'event' in item && item.event === OPEN_ASK);
    expect(ask).toMatchObject({ turnId: liveTurnId, runId });
  });

  it('surfaces truncation when a full-state event above the cut was evicted', async () => {
    const doneTurnId = 'turn-done' as TurnId;
    const liveTurnId = 'turn-live' as TurnId;
    const journals = new ConversationLiveJournals(Number.MAX_SAFE_INTEGER, 2);
    const journal = journals.open(sessionId);
    journal.append(stamped(1, doneTurnId, { type: 'stop', stopReason: 'end_turn' }));
    journal.append(
      stamped(2, liveTurnId, {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't-lost',
          title: 'Completed then lost',
          kind: 'execute',
          status: 'completed',
          content: [],
        },
      }),
    );
    journal.append(stamped(3, liveTurnId, chunk('msg-live', 'one ')));
    journal.append(stamped(4, liveTurnId, chunk('msg-live', 'two')));

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

    // The completed tool snapshot was evicted and will never re-emit — the tail is silently
    // short of it, so the in-flight turn must carry the incompleteness marker.
    const tailEvents = result.events.flatMap((item) => ('event' in item ? [item.event] : []));
    expect(tailEvents).not.toContainEqual(expect.objectContaining({ type: 'tool-call' }));
    expect(result.events).toContainEqual({
      type: 'history-unavailable',
      turnId: liveTurnId,
      runId,
    });
    expect(result.watermark).toEqual({ epoch: 3, seq: 4 });
  });

  it('orders the tail by stamp, never by journal append order', async () => {
    const liveTurnId = 'turn-live' as TurnId;
    const journals = new ConversationLiveJournals();
    const journal = journals.open(sessionId);
    journal.append(stamped(1, liveTurnId, chunk('msg-live', 'one ')));
    journal.append(stamped(2, liveTurnId, chunk('msg-live', 'two')));
    // An old-epoch straggler appended late sits after newer entries in the journal.
    journal.append({
      epoch: 2,
      seq: 9,
      runId,
      turnId: liveTurnId,
      ts: 1,
      event: chunk('msg-old', 'stale'),
    });

    const { service, store } = await makeService({ journals, record: makeRecord(liveTurnId) });
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

    const stamps = result.events.flatMap((item) =>
      'event' in item && item.epoch !== undefined ? [[item.epoch, item.seq]] : [],
    );
    expect(stamps).toEqual([
      [2, 9],
      [3, 1],
      [3, 2],
    ]);
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

describe('conversation projection attribution gate', () => {
  function shellTurn(
    turnId: string,
    parentTurnId: string | null,
    command: string,
    state: ConversationTurnState,
    ordinal = 1,
  ) {
    return {
      turnId: turnId as TurnId,
      sessionId,
      parentTurnId: parentTurnId as TurnId | null,
      siblingOrdinal: ordinal,
      input: { type: 'shell-command' as const, command },
      runId,
      state,
      createdAt: 10,
    };
  }

  function providerUser(itemId: string, command: string, cursor?: string): AgentHistoryEvent {
    return {
      historyId: asHistoryId('hist-1'),
      itemId,
      event: {
        type: 'user-message',
        messageId: itemId as MessageId,
        content: [{ type: 'text', text: `$ ${command}` }],
        ...(cursor !== undefined && { branchCursor: cursor }),
      },
    };
  }

  function providerAnswer(itemId: string, text: string): AgentHistoryEvent {
    return {
      historyId: asHistoryId('hist-1'),
      itemId,
      event: {
        type: 'agent-message',
        messageId: itemId as MessageId,
        content: [{ type: 'text', text }],
      },
    };
  }

  function answers(events: readonly ConversationReadItem[]): Array<[string, TurnId | undefined]> {
    return events.flatMap((item) =>
      'event' in item && item.event.type === 'agent-message' && item.event.messageId !== undefined
        ? [[item.event.messageId as string, item.turnId] as [string, TurnId | undefined]]
        : [],
    );
  }

  function placeholderTurnIds(events: readonly ConversationReadItem[]): TurnId[] {
    return events.flatMap((item) => (!('event' in item) ? [item.turnId] : []));
  }

  it('never attributes positionally on an inactive sibling lineage — even an identical retry', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-b2' as TurnId, true),
      historyEvents: [
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b1', 'turn-a', 'b', 'completed', 1));
    await store.saveTurn(shellTurn('turn-b2', 'turn-a', 'b', 'completed', 2));

    // The inactive sibling B1 carries IDENTICAL prompt text to the active B2: counts and
    // fingerprints both pass, so only the active-lineage gate stops the mis-slice. The shared
    // prefix reads where the active lineage reads.
    const inactive = await Effect.runPromise(
      service.read({ sessionId, leafTurnId: 'turn-b1' as TurnId }),
    );
    expect(answers(inactive.events)).toEqual([['ans-a', 'turn-a']]);
    expect(placeholderTurnIds(inactive.events)).toEqual(['turn-b1']);

    // The active lineage attributes normally.
    const active = await Effect.runPromise(service.read({ sessionId }));
    expect(answers(active.events)).toEqual([
      ['ans-a', 'turn-a'],
      ['ans-b', 'turn-b2'],
    ]);
    expect(placeholderTurnIds(active.events)).toEqual([]);
  });

  it('attributes an inactive lineage against its own run history, never the live one', async () => {
    const forkRunId = 'run-2' as RunId;
    const record: SessionRecord = {
      ...makeRecord('turn-b2' as TurnId, true),
      runs: [
        { runId, startedAt: 1, historyId: asHistoryId('hist-1') },
        { runId: forkRunId, startedAt: 2, historyId: asHistoryId('hist-2') },
      ],
    };
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record,
      historiesById: {
        'hist-1': [
          providerUser('u-a', 'a'),
          providerAnswer('ans-a', 'answer a'),
          providerUser('u-b1', 'b1'),
          providerAnswer('ans-b1', 'answer b1'),
        ],
        // The fork copied the prefix, then the sibling's own turn ran here.
        'hist-2': [
          providerUser('u-a', 'a'),
          providerAnswer('ans-a2', 'answer a'),
          providerUser('u-b2', 'b2'),
          providerAnswer('ans-b2', 'answer b2'),
        ],
      },
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b1', 'turn-a', 'b1', 'completed', 1));
    await store.saveTurn({
      ...shellTurn('turn-b2', 'turn-a', 'b2', 'completed', 2),
      runId: forkRunId,
    });
    // A continue from B1 that never ran: its own lineage still reads from B1's history.
    await store.saveTurn({
      ...shellTurn('turn-c1', 'turn-b1', 'c1', 'failed'),
      runId: 'run-3' as RunId,
    });

    const expectOwnHistory = async (leafTurnId: TurnId) => {
      const inactive = await Effect.runPromise(service.read({ sessionId, leafTurnId }));
      expect(answers(inactive.events)).toEqual([
        ['ans-a', 'turn-a'],
        ['ans-b1', 'turn-b1'],
      ]);
      expect(placeholderTurnIds(inactive.events)).toEqual([]);
    };
    await expectOwnHistory('turn-b1' as TurnId);
    await expectOwnHistory('turn-c1' as TurnId);

    const active = await Effect.runPromise(service.read({ sessionId }));
    expect(answers(active.events)).toEqual([
      ['ans-a2', 'turn-a'],
      ['ans-b2', 'turn-b2'],
    ]);
  });

  it('reads the shared prefix of a lineage whose leaf failed from the live history', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-l' as TurnId, true),
      historyEvents: [
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-l', 'l'),
        providerAnswer('ans-l', 'answer l'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-l', 'turn-a', 'l', 'completed', 1));
    // An edit of L refused at dispatch: a failed sibling on the live run, nothing durable ran.
    await store.saveTurn(shellTurn('turn-l2', 'turn-a', 'l2', 'failed', 2));

    const failed = await Effect.runPromise(
      service.read({ sessionId, leafTurnId: 'turn-l2' as TurnId }),
    );
    expect(answers(failed.events)).toEqual([['ans-a', 'turn-a']]);
    expect(placeholderTurnIds(failed.events)).toEqual([]);
    expect(
      failed.events.flatMap((item) =>
        'event' in item && item.event.type === 'user-message' ? [item.turnId] : [],
      ),
    ).toEqual(['turn-a', 'turn-l2']);
  });

  it('attributes nothing when the trailing extra partition is not the in-flight prompt', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-c' as TurnId, true),
      // Interior injected row: count passes only via the +1 tolerance, which must verify the
      // TRAILING row as the live prompt — here the trailing row is B's, so nothing attributes.
      historyEvents: [
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-x', 'x'),
        providerAnswer('ans-x', 'answer x'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));
    await store.saveTurn(shellTurn('turn-c', 'turn-b', 'c', 'running'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
  });

  it('tolerates exactly one trailing partition that verifies as the in-flight prompt', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-c' as TurnId, true),
      historyEvents: [
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
        providerUser('u-c', 'c'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));
    await store.saveTurn(shellTurn('turn-c', 'turn-b', 'c', 'running'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    expect(answers(result.events)).toEqual([
      ['ans-a', 'turn-a'],
      ['ans-b', 'turn-b'],
    ]);
    expect(placeholderTurnIds(result.events)).toEqual([]);
  });

  it('rejects a count compensated by the live echo when a settled row is missing', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-c' as TurnId, true),
      // A's row vanished (the image-only-prompt lossiness class); the live echo makes the count
      // pass, but position 0 no longer fingerprints as A — nothing may attribute shifted.
      historyEvents: [
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
        providerUser('u-c', 'c'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));
    await store.saveTurn(shellTurn('turn-c', 'turn-b', 'c', 'running'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
  });

  /** A session older than its turn rows: its recorded turns ran on a later run than the first. */
  function hiddenHistoryRecord(activeLeafTurnId: TurnId): SessionRecord {
    const record = makeRecord(activeLeafTurnId, true);
    return {
      ...record,
      runs: [
        { runId: 'run-0' as RunId, startedAt: 0, historyId: asHistoryId('hist-1') },
        ...record.runs,
      ],
    };
  }

  it('aligns the host turns to the corpus tail behind hidden pre-graph history', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-h', 'hidden'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // The hidden head renders unattributed (as a cold read would); every host turn verified.
    expect(answers(result.events)).toEqual([
      ['ans-h', undefined],
      ['ans-a', 'turn-a'],
      ['ans-b', 'turn-b'],
    ]);
    expect(placeholderTurnIds(result.events)).toEqual([]);
  });

  it('attributes nothing behind hidden history when one suffix position mismatches', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-h', 'hidden'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-x', 'x'),
        providerAnswer('ans-x', 'answer x'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // Anchored at the end there is no verified prefix to keep: the alignment itself is unproven.
    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
  });

  it('aligns positionally from the end, so an identical earlier prompt cannot claim a host turn', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-a1', 'a'),
        providerAnswer('ans-a1', 'answer a, the hidden one'),
        providerUser('u-a2', 'a'),
        providerAnswer('ans-a2', 'answer a'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    expect(answers(result.events)).toEqual([
      ['ans-a1', undefined],
      ['ans-a2', 'turn-a'],
      ['ans-b', 'turn-b'],
    ]);
  });

  it('attributes nothing behind hidden history when a later suffix position mismatches', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-h', 'hidden'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-x', 'x'),
        providerAnswer('ans-x', 'answer x'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // Position 0 verifies, but end-anchored a verified prefix proves nothing about the offset.
    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
  });

  it('attributes nothing when the corpus grew past the host’s last turn and the prompts repeat', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-h', 'go', 'before-h'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'go', 'before-a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-b', 'go', 'before-b'),
        providerAnswer('ans-b', 'answer b'),
        providerUser('u-cli', 'go', 'before-cli'),
        providerAnswer('ans-cli', 'answer from the CLI'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'go', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'go', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // The tail [u-b, u-cli] verifies as well as the truth [u-a, u-b]: ambiguous, so nothing
    // attributes and no replay binding — which no later capture would correct — is backfilled.
    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
    expect(await store.listBindings('turn-a' as TurnId)).toEqual([]);
  });

  it('attributes nothing when the peeled live row could equally be the host’s last turn', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-h', 'go'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'go'),
        providerAnswer('ans-a', 'answer a'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'go', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'go', 'running'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // The in-flight prompt may not be persisted yet: `u-a` is either the live row (then `u-h`
    // is turn-a's) or turn-a's own row behind hidden history — nothing attributes.
    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a']);
  });

  it('never aligns to the corpus tail once a failed turn sits on the lineage', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-b' as TurnId),
      historyEvents: [
        providerUser('u-h', 'go'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'go'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-f', 'go'),
        providerAnswer('ans-f', 'answer before the failure'),
        providerUser('u-b', 'done'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'go', 'completed'));
    await store.saveTurn(shellTurn('turn-f', 'turn-a', 'go', 'failed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-f', 'done', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // The failed turn's prompt did reach the provider, so the tail [u-f, u-b] verifies against
    // [turn-a, turn-b] and would hand turn-a the failed turn's answer. A failed turn leaves the
    // row count unknowable, so end-anchoring is off for the lineage.
    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
  });

  it('still tolerates the in-flight turn’s own trailing row behind hidden history', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: hiddenHistoryRecord('turn-c' as TurnId),
      historyEvents: [
        providerUser('u-h', 'hidden'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
        providerUser('u-c', 'c'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));
    await store.saveTurn(shellTurn('turn-c', 'turn-b', 'c', 'running'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    expect(answers(result.events)).toEqual([
      ['ans-h', undefined],
      ['ans-a', 'turn-a'],
      ['ans-b', 'turn-b'],
    ]);
    expect(placeholderTurnIds(result.events)).toEqual([]);
  });

  it('never assumes hidden history on a created session’s first run: extra rows attribute nothing', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-b' as TurnId, true),
      historyEvents: [
        providerUser('u-h', 'hidden'),
        providerAnswer('ans-h', 'answer hidden'),
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-b', 'b'),
        providerAnswer('ans-b', 'answer b'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // Nothing can precede a root on the first run, so more rows than turns is a count anomaly.
    expect(answers(result.events)).toEqual([]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-a', 'turn-b']);
  });

  it('attributes the matching prefix and degrades from the first mismatch onward', async () => {
    const { service, store } = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord('turn-b' as TurnId, true),
      historyEvents: [
        providerUser('u-a', 'a'),
        providerAnswer('ans-a', 'answer a'),
        providerUser('u-z', 'z'),
        providerAnswer('ans-z', 'answer z'),
      ],
    });
    await store.saveTurn(shellTurn('turn-a', null, 'a', 'completed'));
    await store.saveTurn(shellTurn('turn-b', 'turn-a', 'b', 'completed'));

    const result = await Effect.runPromise(service.read({ sessionId }));

    // Position 0 verifies and renders; position 1 mismatches, so B (and everything after it)
    // degrades — alignment is never resynced past a mismatch.
    expect(answers(result.events)).toEqual([['ans-a', 'turn-a']]);
    expect(placeholderTurnIds(result.events)).toEqual(['turn-b']);
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
    expect(first.nextOffset).toBe(1);

    const second = pageReadItems(items, [], 1, 1000, budget);
    expect(second.events).toEqual([items[1]]);
    expect(second.nextOffset).toBeUndefined();

    // An item alone above the budget still ships as its own page.
    const oversized = pageReadItems([textItem('t3', 'z'.repeat(4000))], [], 0, 1000, budget);
    expect(oversized.events).toHaveLength(1);
    expect(oversized.nextOffset).toBeUndefined();
  });

  it('keeps the live tail atomic to the final page', () => {
    const durable = [textItem('t1', 'x'.repeat(100))];
    const tail = [textItem('live', 'w'.repeat(300))];
    const budget = bytes(durable[0]) + 10;

    // The tail does not fit next to the durable remainder: it gets its own final page.
    const first = pageReadItems(durable, tail, 0, 1000, budget);
    expect(first.events).toEqual(durable);
    expect(first.nextOffset).toBe(1);

    const last = pageReadItems(durable, tail, 1, 1000, budget);
    expect(last.events).toEqual(tail);
    expect(last.nextOffset).toBeUndefined();
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
    expect(page.nextOffset).toBeUndefined();
  });
});

describe('conversation read cursor integrity', () => {
  async function pagedService() {
    const liveTurnId = 'turn-live' as TurnId;
    const setup = await makeService({
      journals: new ConversationLiveJournals(),
      record: makeRecord(liveTurnId),
    });
    await setup.store.saveTurn({
      turnId: 'turn-done' as TurnId,
      sessionId,
      parentTurnId: null,
      siblingOrdinal: 1,
      input: { type: 'shell-command', command: 'ls' },
      runId,
      state: 'completed',
      createdAt: 5,
    });
    await setup.store.saveTurn({
      turnId: liveTurnId,
      sessionId,
      parentTurnId: 'turn-done' as TurnId,
      siblingOrdinal: 1,
      input: { type: 'shell-command', command: 'pwd' },
      runId,
      state: 'running',
      createdAt: 10,
    });
    return { ...setup, liveTurnId };
  }

  async function expectConflict(
    effect: Effect.Effect<unknown, RequestError | unknown>,
  ): Promise<void> {
    const exit = await Effect.runPromiseExit(effect);
    if (!Exit.isFailure(exit)) throw new Error('expected a conflict failure');
    const error = Cause.squash(exit.cause);
    if (!(error instanceof RequestError)) throw new Error('expected a RequestError');
    expect(error.code).toBe('conflict');
  }

  it('pages with a structured cursor and rejects it once a turn settles', async () => {
    const { service, store, liveTurnId } = await pagedService();

    const first = await Effect.runPromise(service.read({ sessionId, limit: 1 }));
    expect(first.cursor).toBeDefined();
    expect(first.watermark).toBeUndefined();

    const second = await Effect.runPromise(
      service.read({ sessionId, cursor: first.cursor, limit: 1 }),
    );
    expect(second.events).toHaveLength(1);

    // The live turn settles WITHOUT a graph-revision bump: the attribution gate's shape flipped,
    // so the old cursor must conflict instead of splicing across the mutation.
    await store.saveTurn({
      turnId: liveTurnId,
      sessionId,
      parentTurnId: 'turn-done' as TurnId,
      siblingOrdinal: 1,
      input: { type: 'shell-command', command: 'pwd' },
      runId,
      state: 'completed',
      createdAt: 10,
    });
    await expectConflict(service.read({ sessionId, cursor: first.cursor, limit: 1 }));
  });

  it('rejects undecodable and tampered cursors instead of restarting silently', async () => {
    const { service } = await pagedService();
    await expectConflict(service.read({ sessionId, cursor: 'garbage' }));
    await expectConflict(service.read({ sessionId, cursor: '{}' }));
    await expectConflict(
      service.read({
        sessionId,
        cursor: JSON.stringify({
          graphRevision: 999,
          leafTurnId: 'turn-live',
          settled: 1,
          offset: 1,
        }),
      }),
    );
  });
});
