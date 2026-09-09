import type {
  AgentEvent,
  ContentBlock,
  ConversationReadItem,
  ConversationWatermark,
  MessageId,
  SessionId,
  TurnId,
} from '@linkcode/schema';
import { userRowMessageId } from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { noop } from 'foxact/noop';
import { wait } from 'foxts/wait';
import { describe, expect, it } from 'vitest';
import type { ConversationProjectionSeed } from '../../src/conversation-read';
import type { ConversationResyncReason } from '../../src/conversation-store';
import { createConversationStore } from '../../src/conversation-store';
import { createConnectedLocalClient } from '../support/local-client';

const sessionId = 'sess-projection' as SessionId;
const turn = (n: number): TurnId => `turn-${n}` as TurnId;
const IMAGE: ContentBlock = { type: 'image', data: 'cG5n', mimeType: 'image/png' };

function echo(n: number, text: string, extra: Partial<AgentEvent> = {}): AgentEvent {
  return {
    type: 'user-message',
    messageId: userRowMessageId(turn(n)),
    content: [{ type: 'text', text }],
    ...extra,
  } as AgentEvent;
}

function chunk(messageId: string, text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text },
  };
}

function userRow(n: number, text: string): ConversationReadItem {
  return { turnId: turn(n), ts: 1_700_000_000_000 + n, event: echo(n, text) };
}

function tailItem(event: AgentEvent, position: ConversationWatermark): ConversationReadItem {
  return { ...position, event };
}

function seedOf(
  items: ConversationReadItem[],
  watermark?: ConversationWatermark,
  graphRevision = 1,
): ConversationProjectionSeed {
  return {
    items,
    graphRevision,
    leafTurnId: turn(99),
    ...(watermark !== undefined && { watermark }),
  };
}

function texts(store: ReturnType<typeof createConversationStore>): string[] {
  return store.getSnapshot().items.flatMap((item) => {
    if (item.kind !== 'message') return [item.kind];
    return item.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  });
}

async function harness() {
  const { client, serverTransport } = await createConnectedLocalClient();
  const resyncs: ConversationResyncReason[] = [];
  return {
    client,
    resyncs,
    send(this: void, event: AgentEvent, position?: ConversationWatermark) {
      serverTransport.send(
        createWireMessage({ kind: 'agent.event', sessionId, ...position, event }),
      );
    },
    graphChanged(this: void, graphRevision: number, activeLeafTurnId: TurnId) {
      serverTransport.send(
        createWireMessage({
          kind: 'conversation.graph.changed',
          sessionId,
          graphRevision,
          activeLeafTurnId,
        }),
      );
    },
    store(this: void, seed: ConversationProjectionSeed) {
      return createConversationStore(client, sessionId, seed, {
        onResync: (reason) => resyncs.push(reason),
      });
    },
    close(this: void) {
      client.dispose();
      serverTransport.close();
    },
  };
}

const tick = (): Promise<void> => wait(10);

describe('projection conversation store', () => {
  it('folds the read and drops the live events it already covers', async () => {
    const h = await harness();
    h.send(echo(1, 'hello'), { epoch: 1, seq: 1 });
    h.send(chunk('a1', 'Hello'), { epoch: 1, seq: 2 });
    await tick();

    const store = h.store(
      seedOf([userRow(1, 'hello'), tailItem(chunk('a1', 'Hello'), { epoch: 1, seq: 2 })], {
        epoch: 1,
        seq: 2,
      }),
    );
    expect(texts(store)).toEqual(['hello', 'Hello']);
    const seeded = store.getSnapshot();
    expect(store.getSnapshot()).toBe(seeded);

    h.send(chunk('a1', ' world'), { epoch: 1, seq: 3 });
    await tick();
    expect(texts(store)).toEqual(['hello', 'Hello world']);
    // Previously returned snapshots are never mutated.
    expect(seeded.items).toHaveLength(2);
    expect(h.resyncs).toEqual([]);
    h.close();
  });

  it('keeps interactive events below the watermark (the permission-card backstop)', async () => {
    const h = await harness();
    h.send(
      {
        type: 'permission-request',
        requestId: 'p1',
        toolCall: { toolCallId: 't1', title: 'Bash' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
      { epoch: 1, seq: 3 },
    );
    await tick();

    const store = h.store(seedOf([userRow(1, 'run it')], { epoch: 1, seq: 4 }));
    expect(store.getSnapshot().pendingPermissionIds).toEqual(['p1']);
    h.close();
  });

  it('folds unstamped frames regardless of the watermark', async () => {
    const h = await harness();
    h.send({ type: 'status', status: 'running' });
    await tick();

    const store = h.store(seedOf([userRow(1, 'hi')], { epoch: 1, seq: 9 }));
    expect(store.getSnapshot().status).toBe('running');
    await tick();
    expect(h.resyncs).toEqual([]);
    h.close();
  });

  it('drops an older epoch’s straggler and asks for one re-read on an epoch jump', async () => {
    const h = await harness();
    const store = h.store(seedOf([userRow(1, 'first')], { epoch: 2, seq: 0 }));
    h.send(chunk('stale', 'from the replaced adapter'), { epoch: 1, seq: 9 });
    h.send(echo(2, 'second'), { epoch: 2, seq: 1 });
    await tick();
    expect(texts(store)).toEqual(['first', 'second']);
    expect(h.resyncs).toEqual([]);

    h.send(echo(3, 'after relaunch'), { epoch: 3, seq: 1 });
    h.send(chunk('a3', 'reply'), { epoch: 3, seq: 2 });
    await tick();
    // Folding continues while the owner re-reads, and the request fires once.
    expect(texts(store)).toEqual(['first', 'second', 'after relaunch', 'reply']);
    await tick();
    expect(h.resyncs).toEqual(['epoch']);
    h.close();
  });

  it('asks for a re-read on a sequence gap', async () => {
    const h = await harness();
    const store = h.store(seedOf([userRow(1, 'first')], { epoch: 1, seq: 3 }));
    h.send(chunk('a1', 'seen'), { epoch: 1, seq: 5 });
    await tick();
    expect(texts(store)).toEqual(['first', 'seen']);
    await tick();
    expect(h.resyncs).toEqual(['gap']);
    h.close();
  });

  it('asks for a re-read when the graph moved past the read to a leaf it never saw', async () => {
    const h = await harness();
    const store = h.store(seedOf([userRow(1, 'first')], { epoch: 1, seq: 1 }, 3));
    store.subscribe(noop);
    h.graphChanged(4, turn(9));
    await tick();
    expect(h.resyncs).toEqual(['graph']);
    h.close();
  });

  it('asks a live-only store to re-read when a leaf appears', async () => {
    const h = await harness();
    const store = createConversationStore(h.client, sessionId, undefined, {
      onResync: (reason) => h.resyncs.push(reason),
    });
    store.subscribe(noop);
    h.graphChanged(1, turn(1));
    await tick();
    expect(h.resyncs).toEqual(['graph']);
    h.close();
  });

  it('treats a graph move onto a leaf whose row arrived live as a plain continuation', async () => {
    const h = await harness();
    const store = h.store(seedOf([userRow(1, 'first')], { epoch: 1, seq: 1 }, 3));
    store.subscribe(noop);
    h.send(echo(9, 'second'), { epoch: 1, seq: 2 });
    h.graphChanged(4, turn(9));
    await tick();
    expect(texts(store)).toEqual(['first', 'second']);
    expect(h.resyncs).toEqual([]);
    h.close();
  });

  it('renders history-unavailable placeholders under their turn', async () => {
    const h = await harness();
    const store = h.store(
      seedOf(
        [
          userRow(1, 'lost'),
          { type: 'history-unavailable', turnId: turn(1) },
          userRow(2, 'kept'),
          tailItem(chunk('a2', 'answer'), { epoch: 1, seq: 1 }),
        ],
        { epoch: 1, seq: 1 },
      ),
    );
    const { items } = store.getSnapshot();
    expect(items.map((item) => item.kind)).toEqual([
      'message',
      'history-unavailable',
      'message',
      'message',
    ]);
    expect(items[1].turnId).toBe(items[0].turnId);
    expect(items[3].turnId).toBe(items[2].turnId);
    h.close();
  });

  it('keeps the durable row’s blocks even when a live echo carries attachments', async () => {
    const h = await harness();
    h.send(
      echo(1, 'describe this', { content: [{ type: 'text', text: 'describe this' }, IMAGE] }),
      {
        epoch: 1,
        seq: 1,
      },
    );
    await tick();

    const link: ContentBlock = {
      type: 'resource_link',
      uri: 'attachment:att-1',
      name: 'shot.png',
    };
    const store = h.store(
      seedOf(
        [
          {
            turnId: turn(1),
            ts: 1_700_000_000_001,
            event: echo(1, 'describe this', {
              content: [{ type: 'text', text: 'describe this' }, link],
            }),
          },
        ],
        { epoch: 1, seq: 1 },
      ),
    );
    const [row] = store.getSnapshot().items;
    expect(row.kind === 'message' && row.blocks).toEqual([
      { type: 'text', text: 'describe this' },
      link,
    ]);
    h.close();
  });

  it('does not let a live echo above the watermark replace durable attachment refs', async () => {
    const h = await harness();
    const link: ContentBlock = {
      type: 'resource_link',
      uri: 'attachment:att-1',
      name: 'shot.png',
    };
    h.send(echo(1, 'describe this'), { epoch: 1, seq: 2 });
    await tick();

    const store = h.store(
      seedOf(
        [
          {
            turnId: turn(1),
            ts: 1_700_000_000_001,
            event: echo(1, 'describe this', {
              content: [{ type: 'text', text: 'describe this' }, link],
            }),
          },
        ],
        { epoch: 1, seq: 1 },
      ),
    );
    const [row] = store.getSnapshot().items;
    expect(row.kind === 'message' && row.blocks).toEqual([
      { type: 'text', text: 'describe this' },
      link,
    ]);
    h.close();
  });

  it('gives repeated echoes and re-reads one row per turn, in order', async () => {
    const h = await harness();
    // The engine's double echo: bare first, then again with the cursor once the history binds.
    h.send(echo(1, 'old'), { epoch: 1, seq: 1 });
    h.send(echo(1, 'old', { branchCursor: 'cursor-1' }), { epoch: 1, seq: 2 });
    h.send(echo(2, 'new'), { epoch: 1, seq: 3 });
    await tick();

    const seed = seedOf([userRow(1, 'old'), userRow(2, 'new')], { epoch: 1, seq: 3 });
    expect(texts(h.store(seed))).toEqual(['old', 'new']);
    // A reseed (focus, reconnect) folds the same rows again — never ['old', 'new', 'old'].
    expect(texts(h.store(seed))).toEqual(['old', 'new']);
    h.close();
  });

  it('keeps duplicate-text prompts as distinct, stable rows across a reseed', async () => {
    const h = await harness();
    const seed = seedOf([userRow(1, 'repeat'), userRow(2, 'repeat')], { epoch: 1, seq: 0 });
    const ids = (store: ReturnType<typeof h.store>): string[] =>
      store.getSnapshot().items.map((item) => item.id);
    expect(ids(h.store(seed))).toEqual([userRowMessageId(turn(1)), userRowMessageId(turn(2))]);
    expect(ids(h.store(seed))).toEqual([userRowMessageId(turn(1)), userRowMessageId(turn(2))]);
    h.close();
  });

  it('lets a persisted seed supersede nothing while the first stamped event sets the baseline', async () => {
    const h = await harness();
    h.send(echo(1, 'hello'), { epoch: 1, seq: 1 });
    h.send(chunk('a1', 'reply'), { epoch: 1, seq: 2 });
    await tick();

    // Loaded from the seed cache: same rows, no watermark — the buffered echo folds onto its row.
    const store = h.store(seedOf([userRow(1, 'hello')]));
    expect(texts(store)).toEqual(['hello', 'reply']);
    h.send(chunk('a1', ' more'), { epoch: 1, seq: 4 });
    await tick();
    expect(texts(store)).toEqual(['hello', 'reply more']);
    await tick();
    expect(h.resyncs).toEqual(['gap']);
    h.close();
  });

  it('keeps an in-flight stream whole across a mid-turn reseed', async () => {
    const h = await harness();
    h.send(echo(1, 'tell a story'), { epoch: 1, seq: 1 });
    h.send(chunk('m1', 'Once '), { epoch: 1, seq: 2 });
    h.send(chunk('m1', 'upon '), { epoch: 1, seq: 3 });
    await tick();
    const before = h.store(seedOf([userRow(1, 'tell a story')], { epoch: 1, seq: 1 }));
    expect(texts(before)).toEqual(['tell a story', 'Once upon ']);

    // The reseed's tail holds the chunks flushed so far; the next one arrives live.
    const reseeded = h.store(
      seedOf(
        [
          userRow(1, 'tell a story'),
          tailItem(chunk('m1', 'Once '), { epoch: 1, seq: 2 }),
          tailItem(chunk('m1', 'upon '), { epoch: 1, seq: 3 }),
        ],
        { epoch: 1, seq: 3 },
      ),
    );
    h.send(chunk('m1', 'a time.'), { epoch: 1, seq: 4 });
    await tick();
    expect(texts(reseeded)).toEqual(['tell a story', 'Once upon a time.']);
    expect(h.resyncs).toEqual([]);
    h.close();
  });
});
