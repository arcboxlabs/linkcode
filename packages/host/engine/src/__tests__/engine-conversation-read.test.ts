import { Buffer } from 'node:buffer';
import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentEvent,
  AgentHistoryEvent,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  ConversationReadItem,
  MessageId,
  WirePayload,
} from '@linkcode/schema';
import {
  MAX_ATTACHMENT_TOTAL_BASE64_LENGTH,
  OperationIdSchema,
  SessionIdSchema,
} from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import {
  FakeAdapter,
  createSessionHarness as harness,
  settleEngineTasks,
  startedSessionId as startedId,
} from './fixtures/session-harness';

const HISTORY_ID = asHistoryId('hist-1');

interface SharedHistory {
  events: AgentHistoryEvent[];
  failRead: boolean;
  lastReadOpts?: AgentHistoryReadOptions;
}

/** Provider history double: canned corpus, optionally failing reads (the CODE-645 class). The
 * corpus is shared across instances because cold reads construct a fresh adapter per call. */
class HistoryFakeAdapter extends FakeAdapter {
  constructor(private readonly shared: SharedHistory) {
    super();
  }

  override readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    this.shared.lastReadOpts = opts;
    if (this.shared.failRead) {
      return Promise.reject(new Error('history_mode paginated is unsupported'));
    }
    return Promise.resolve({
      session: { historyId: opts.historyId, kind: this.kind, cwd: '/repo', createdAt: 1 },
      events: [...this.shared.events],
    });
  }
}

function historyEvent(itemId: string, event: AgentEvent): AgentHistoryEvent {
  return { historyId: HISTORY_ID, itemId, event };
}

function userRow(itemId: string, text: string): AgentHistoryEvent {
  return historyEvent(itemId, {
    type: 'user-message',
    messageId: itemId as MessageId,
    content: [{ type: 'text', text }],
  });
}

function assistantRow(itemId: string, text: string): AgentHistoryEvent {
  return historyEvent(itemId, {
    type: 'agent-message',
    messageId: itemId as MessageId,
    content: [{ type: 'text', text }],
  });
}

async function startedHarness(makeAdapter: () => FakeAdapter = () => new FakeAdapter()) {
  const h = harness(undefined, makeAdapter);
  await h.engine.start();
  await h.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind: 'claude-code', cwd: '/repo' },
  });
  const sessionId = startedId(h.sent, 'r1');
  return { ...h, sessionId, adapter: nullthrow(h.adapters[0]) };
}

type Harness = Awaited<ReturnType<typeof startedHarness>>;

async function completeTurn(h: Harness, clientReqId: string, text: string): Promise<void> {
  await h.inject({
    kind: 'turn.submit',
    clientReqId,
    sessionId: h.sessionId,
    operationId: OperationIdSchema.parse(`op-${clientReqId}`),
    input: { type: 'prompt', blocks: [{ type: 'text', text }] },
  });
  h.adapter.emit({ type: 'stop', stopReason: 'end_turn' });
  h.adapter.emit({ type: 'status', status: 'idle' });
  await settleEngineTasks();
}

function readResult(sent: WirePayload[], replyTo: string) {
  const reply = sent.find(
    (payload) => payload.kind === 'conversation.read.result' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'conversation.read.result') {
    throw new Error(`no conversation.read.result for ${replyTo}`);
  }
  return reply;
}

function graphResult(sent: WirePayload[], replyTo: string) {
  const reply = sent.find(
    (payload) => payload.kind === 'conversation.graph.result' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'conversation.graph.result') {
    throw new Error(`no conversation.graph.result for ${replyTo}`);
  }
  return reply;
}

function userTexts(events: readonly ConversationReadItem[]): string[] {
  return events.flatMap((item) => {
    if (!('event' in item) || item.event.type !== 'user-message') return [];
    return item.event.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
  });
}

describe('conversation.graph.get', () => {
  it('serves the turn tree with states, ordinals, and input summaries', async () => {
    const h = await startedHarness();
    await completeTurn(h, 's1', 'first prompt');
    await completeTurn(h, 's2', 'second prompt');

    await h.inject({ kind: 'conversation.graph.get', clientReqId: 'g1', sessionId: h.sessionId });

    const graph = graphResult(h.sent, 'g1');
    expect(graph.graphRevision).toBe(2);
    expect(graph.turns).toHaveLength(2);
    const [first, second] = graph.turns;
    expect(first).toMatchObject({
      parentTurnId: null,
      siblingOrdinal: 1,
      state: 'completed',
      inputSummary: 'first prompt',
    });
    expect(second).toMatchObject({
      parentTurnId: first.turnId,
      siblingOrdinal: 1,
      state: 'completed',
      inputSummary: 'second prompt',
    });
    expect(graph.activeLeafTurnId).toBe(second.turnId);
  });

  it('fails loudly for an unknown session instead of dropping the request', async () => {
    const h = await startedHarness();

    const unknown = SessionIdSchema.parse('session-x');
    await h.inject({ kind: 'conversation.graph.get', clientReqId: 'g-x', sessionId: unknown });
    await h.inject({ kind: 'conversation.read', clientReqId: 'r-x', sessionId: unknown });

    expect(h.sent).toContainEqual(
      expect.objectContaining({ kind: 'request.failed', replyTo: 'g-x', code: 'not_found' }),
    );
    expect(h.sent).toContainEqual(
      expect.objectContaining({ kind: 'request.failed', replyTo: 'r-x', code: 'not_found' }),
    );
  });
});

describe('conversation.read', () => {
  it('renders prompts and placeholders when the harness has no history', async () => {
    const h = await startedHarness();
    await completeTurn(h, 's1', 'hello one');
    await completeTurn(h, 's2', 'hello two');
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });

    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });

    const result = readResult(h.sent, 'rr');
    expect(result.cursor).toBeUndefined();
    expect(result.watermark).toBeDefined();
    expect(userTexts(result.events)).toEqual(['hello one', 'hello two']);
    const placeholders = result.events.filter((item) => !('event' in item));
    expect(placeholders).toHaveLength(2);
    // Placeholders sit under their own turns, interleaved with the prompts.
    expect(result.events.map((item) => ('event' in item ? item.event.type : item.type))).toEqual([
      'user-message',
      'history-unavailable',
      'user-message',
      'history-unavailable',
    ]);
  });

  it('degrades to the prompt-only fallback when the provider read fails', async () => {
    const shared: SharedHistory = { events: [], failRead: true };
    const h = await startedHarness(() => new HistoryFakeAdapter(shared));
    h.adapter.emit({ type: 'session-ref', historyId: HISTORY_ID });
    await completeTurn(h, 's1', 'still readable');
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });

    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });

    const result = readResult(h.sent, 'rr');
    expect(userTexts(result.events)).toEqual(['still readable']);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'history-unavailable' }));
    expect(h.sent).not.toContainEqual(
      expect.objectContaining({ kind: 'request.failed', replyTo: 'rr' }),
    );
  });

  it('merges provider assistant output under host user rows', async () => {
    const shared: SharedHistory = { events: [], failRead: false };
    const h = await startedHarness(() => new HistoryFakeAdapter(shared));
    h.adapter.emit({ type: 'session-ref', historyId: HISTORY_ID });
    await completeTurn(h, 's1', 'real prompt');
    shared.events = [userRow('u1', 'real prompt'), assistantRow('a1', 'provider answer')];
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });

    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });

    const result = readResult(h.sent, 'rr');
    // The user row is host truth, rendered exactly once — the provider's own row never doubles it.
    expect(userTexts(result.events)).toEqual(['real prompt']);
    const assistant = result.events.find(
      (item) => 'event' in item && item.event.type === 'agent-message',
    );
    expect(assistant).toBeDefined();
    if (assistant === undefined || !('event' in assistant)) throw new Error('unreachable');
    expect(assistant.turnId).toBeDefined();
    expect(assistant.runId).toBeDefined();
    expect(result.events).not.toContainEqual(
      expect.objectContaining({ type: 'history-unavailable' }),
    );
    // codex resolves its rollout home through the project env, so the read must carry the cwd.
    expect(shared.lastReadOpts?.cwd).toBe('/repo');
  });

  it('refreshes a stale corpus captured before the newest settle', async () => {
    const shared: SharedHistory = { events: [], failRead: false };
    const h = await startedHarness(() => new HistoryFakeAdapter(shared));
    h.adapter.emit({ type: 'session-ref', historyId: HISTORY_ID });
    shared.events = [userRow('u1', 'one prompt'), assistantRow('a1', 'answer one')];
    await completeTurn(h, 's1', 'one prompt');
    // Warm the TTL cache with the one-turn corpus.
    await h.inject({ kind: 'conversation.read', clientReqId: 'rr-1', sessionId: h.sessionId });
    expect(userTexts(readResult(h.sent, 'rr-1').events)).toEqual(['one prompt']);

    shared.events = [
      userRow('u1', 'one prompt'),
      assistantRow('a1', 'answer one'),
      userRow('u2', 'two prompt'),
      assistantRow('a2', 'answer two'),
    ];
    await completeTurn(h, 's2', 'two prompt');
    await h.inject({ kind: 'conversation.read', clientReqId: 'rr-2', sessionId: h.sessionId });

    // A cached one-turn corpus would degrade both turns to placeholders; the settle forces a
    // cache-bypassing refresh, so the new turn's answer attributes.
    const result = readResult(h.sent, 'rr-2');
    expect(result.events).not.toContainEqual(
      expect.objectContaining({ type: 'history-unavailable' }),
    );
    expect(result.events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'agent-message', messageId: 'a2' }),
      }),
    );
  });

  it('refreshes a mid-turn capture whose settled turn had no answer rows yet', async () => {
    const shared: SharedHistory = { events: [], failRead: false };
    const h = await startedHarness(() => new HistoryFakeAdapter(shared));
    h.adapter.emit({ type: 'session-ref', historyId: HISTORY_ID });
    shared.events = [userRow('u1', 'one prompt'), assistantRow('a1', 'answer one')];
    await completeTurn(h, 's1', 'one prompt');
    // Turn two is dispatched; the provider has written its echo but no answer yet.
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's2',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-s2-live'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'two prompt' }] },
    });
    h.adapter.emit({ type: 'status', status: 'running' });
    await settleEngineTasks();
    shared.events = [
      userRow('u1', 'one prompt'),
      assistantRow('a1', 'answer one'),
      userRow('u2', 'two prompt'),
    ];
    // Warm the cache mid-turn: the trailing echo verifies as the in-flight turn's own row.
    await h.inject({ kind: 'conversation.read', clientReqId: 'rr-mid', sessionId: h.sessionId });
    expect(userTexts(readResult(h.sent, 'rr-mid').events)).toEqual(['one prompt', 'two prompt']);

    h.adapter.emit({ type: 'stop', stopReason: 'end_turn' });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await settleEngineTasks();
    shared.events = [...shared.events, assistantRow('a2', 'answer two')];
    await h.inject({ kind: 'conversation.read', clientReqId: 'rr-2', sessionId: h.sessionId });

    // Without the settle-driven refresh, the cached capture passes every gate with an empty
    // partition and the settled turn renders answer-less forever.
    expect(readResult(h.sent, 'rr-2').events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'agent-message', messageId: 'a2' }),
      }),
    );
  });

  it('serves the live tail with stamps, open asks, and no duplicated user echo', async () => {
    const h = await startedHarness();
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's1',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-live'),
      input: { type: 'prompt', blocks: [{ type: 'text', text: 'live prompt' }] },
    });
    h.adapter.emit({ type: 'status', status: 'running' });
    h.adapter.emit({
      type: 'agent-message-chunk',
      messageId: 'msg-live' as MessageId,
      content: { type: 'text', text: 'streaming…' },
    });
    h.adapter.emit({
      type: 'permission-request',
      requestId: 'perm-live',
      title: 'Run',
      subject: { type: 'tool-call', toolCallId: 't1' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
    });
    await settleEngineTasks();

    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });

    const result = readResult(h.sent, 'rr');
    expect(result.cursor).toBeUndefined();
    expect(result.watermark).toBeDefined();
    // The in-flight prompt renders once, from host truth — the live echo never doubles it.
    expect(userTexts(result.events)).toEqual(['live prompt']);
    const chunkItem = result.events.find(
      (item) => 'event' in item && item.event.type === 'agent-message-chunk',
    );
    expect(chunkItem).toBeDefined();
    if (chunkItem === undefined || !('event' in chunkItem)) throw new Error('unreachable');
    expect(chunkItem.epoch).toBeDefined();
    expect(chunkItem.seq).toBeDefined();
    expect(result.events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'permission-request', requestId: 'perm-live' }),
      }),
    );
  });

  it('pages by the logical-message byte budget with the watermark on the final page only', async () => {
    const h = await startedHarness();
    await completeTurn(h, 's1', big('a'));
    await completeTurn(h, 's2', big('b'));
    await completeTurn(h, 's3', big('c'));
    await h.inject({ kind: 'session.stop', clientReqId: 'stop', sessionId: h.sessionId });

    const pages = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const clientReqId = `rr-${page}`;
      // eslint-disable-next-line no-await-in-loop -- cursor paging is sequential by nature.
      await h.inject({
        kind: 'conversation.read',
        clientReqId,
        sessionId: h.sessionId,
        ...(cursor !== undefined && { cursor }),
      });
      const result = readResult(h.sent, clientReqId);
      pages.push(result);
      cursor = result.cursor;
      if (cursor === undefined) break;
    }

    expect(pages.length).toBeGreaterThan(1);
    for (let i = 0, len = pages.length; i < len; i++) {
      const page = pages[i];
      const final = i === pages.length - 1;
      // Only the final page carries the merge watermark; earlier pages carry none.
      expect(page.watermark === undefined).toBe(!final);
      expect(page.cursor === undefined).toBe(final);
      const pageBytes = page.events.reduce(
        (sum, item) => sum + Buffer.byteLength(JSON.stringify(item), 'utf8'),
        0,
      );
      expect(pageBytes).toBeLessThanOrEqual(MAX_ATTACHMENT_TOTAL_BASE64_LENGTH);
    }
    // Nothing is lost across the page split.
    expect(pages.flatMap((page) => userTexts(page.events))).toEqual([big('a'), big('b'), big('c')]);
  }, 30000);
});

/** Big enough that two prompts cannot share one page under the ~16 MiB budget. */
function big(fill: string): string {
  return fill.repeat(9 * 1024 * 1024);
}
