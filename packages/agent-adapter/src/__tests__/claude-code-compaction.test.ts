import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import type { ClaudeCompactionSupplement } from '../native/claude-code';
import { buildClaudeCompactionSupplement, ClaudeCodeAdapter } from '../native/claude-code';

/**
 * Context compaction (CODE-141), verified live against SDK 0.3.179: the CLI compacts **in place**
 * (`session_id` never changes), emitting a `system/compact_boundary` frame then the swapped-in
 * summary as an `isReplay` user frame keyed by the boundary's anchor uuid. The adapter must
 * announce the `compaction` event at the boundary, attach the summary before the replay guard
 * drops it, and reproduce the marker (not a fake giant user prompt) on history re-read.
 */

type CompactionEvent = Extract<AgentEvent, { type: 'compaction' }>;

class TestClaude extends ClaudeCodeAdapter {
  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }
}

function harness() {
  const adapter = new TestClaude();
  const seen: AgentEvent[] = [];
  adapter.onEvent((e) => seen.push(e));
  return {
    feed: (value: object) => adapter.feed(value),
    events: seen,
    compactions: () => seen.filter((e): e is CompactionEvent => e.type === 'compaction'),
  };
}

const BOUNDARY_UUID = 'uuid-boundary';
const ANCHOR_UUID = 'uuid-summary';

function boundary(overrides?: { anchorless?: boolean }): object {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    session_id: 'sid-1',
    uuid: BOUNDARY_UUID,
    compact_metadata: {
      trigger: 'auto',
      pre_tokens: 193437,
      post_tokens: 1474,
      ...(!overrides?.anchorless && {
        preserved_messages: { anchor_uuid: ANCHOR_UUID, uuids: ['uuid-a'] },
      }),
    },
  };
}

function summaryFrame(overrides?: { uuid?: string; isSynthetic?: boolean }): object {
  return {
    type: 'user',
    session_id: 'sid-1',
    uuid: overrides?.uuid ?? ANCHOR_UUID,
    parent_tool_use_id: null,
    isReplay: true,
    isSynthetic: overrides?.isSynthetic ?? true,
    message: { role: 'user', content: 'This session is being continued…\n\nSummary: did things.' },
  };
}

describe('ClaudeCodeAdapter live compaction', () => {
  it('announces the boundary with its metadata', () => {
    const h = harness();
    h.feed(boundary());
    expect(h.compactions()).toEqual([
      {
        type: 'compaction',
        compactionId: BOUNDARY_UUID,
        trigger: 'auto',
        preTokens: 193437,
        postTokens: 1474,
      },
    ]);
  });

  it('re-emits the same compactionId with the summary once the anchor frame arrives', () => {
    const h = harness();
    h.feed(boundary());
    h.feed(summaryFrame());
    const [, withSummary] = h.compactions();
    expect(withSummary).toMatchObject({
      compactionId: BOUNDARY_UUID,
      trigger: 'auto',
      summary: 'This session is being continued…\n\nSummary: did things.',
    });
    // The summary frame must not leak any other event (it is not a user prompt).
    expect(h.events.filter((e) => e.type !== 'compaction' && e.type !== 'session-ref')).toEqual([]);
  });

  it('matches the summary via isSynthetic when the boundary carries no anchor', () => {
    const h = harness();
    h.feed(boundary({ anchorless: true }));
    h.feed(summaryFrame({ uuid: 'uuid-other' }));
    expect(h.compactions()).toHaveLength(2);
    expect(h.compactions()[1].summary).toContain('Summary: did things.');
  });

  it('consumes the boundary stash: later replay frames stay dropped', () => {
    const h = harness();
    h.feed(boundary());
    h.feed(summaryFrame());
    h.feed(summaryFrame({ uuid: 'uuid-later' }));
    expect(h.compactions()).toHaveLength(2);
  });

  it('ignores replay user frames when no compaction is pending', () => {
    const h = harness();
    h.feed(summaryFrame());
    expect(h.compactions()).toEqual([]);
  });
});

describe('buildClaudeCompactionSupplement', () => {
  const boundaryRow = JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    uuid: BOUNDARY_UUID,
    compactMetadata: { trigger: 'manual', preTokens: 484135, postTokens: 2378 },
  });
  const summaryRow = JSON.stringify({
    type: 'user',
    uuid: ANCHOR_UUID,
    isCompactSummary: true,
    message: { role: 'user', content: 'Summary text.' },
  });
  const convRow = (type: 'user' | 'assistant', uuid: string, extra?: object) =>
    JSON.stringify({
      type,
      uuid,
      sessionId: 'sid-1',
      message: { role: type, content: `${uuid} says` },
      ...extra,
    });

  it('keys the boundary record by the summary row uuid', () => {
    const supplement = buildClaudeCompactionSupplement([boundaryRow, summaryRow]);
    expect(supplement.records.get(ANCHOR_UUID)).toEqual({
      compactionId: BOUNDARY_UUID,
      trigger: 'manual',
      preTokens: 484135,
      postTokens: 2378,
    });
  });

  it('collects the rows before the last boundary as dropped, excluding meta/sidechain rows', () => {
    const supplement = buildClaudeCompactionSupplement([
      convRow('user', 'u0'),
      convRow('assistant', 'a0'),
      convRow('user', 'meta0', { isMeta: true }),
      convRow('assistant', 'side0', { isSidechain: true }),
      boundaryRow,
      summaryRow,
      convRow('user', 'u1'),
    ]);
    expect(supplement.droppedRows.map((r) => r.uuid)).toEqual(['u0', 'a0']);
    expect(supplement.droppedRows[0]).toMatchObject({
      type: 'user',
      session_id: 'sid-1',
      parent_tool_use_id: null,
    });
  });

  it('drops everything before the LAST boundary when compaction happened twice', () => {
    const boundary2 = JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'uuid-boundary-2',
      compactMetadata: { trigger: 'auto', preTokens: 9, postTokens: 1 },
    });
    const summary2 = JSON.stringify({
      type: 'user',
      uuid: 'uuid-summary-2',
      isCompactSummary: true,
      message: { role: 'user', content: 'Second summary.' },
    });
    const supplement = buildClaudeCompactionSupplement([
      convRow('user', 'u0'),
      boundaryRow,
      summaryRow,
      convRow('user', 'u1'),
      boundary2,
      summary2,
      convRow('user', 'u2'),
    ]);
    // The first summary row rides along in droppedRows: the mapper turns it into the first
    // compaction's marker, so a twice-compacted session keeps both markers.
    expect(supplement.droppedRows.map((r) => r.uuid)).toEqual(['u0', ANCHOR_UUID, 'u1']);
    expect(supplement.records.size).toBe(2);
  });

  it('skips corrupt lines and rows without the markers', () => {
    const supplement = buildClaudeCompactionSupplement([
      '{"type":"system","subtype":"compact_boundary"', // torn write
      JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'plain compact talk' } }),
      boundaryRow,
      summaryRow,
    ]);
    expect(supplement.records.size).toBe(1);
  });

  it('keys an orphaned summary row by its own uuid', () => {
    const supplement = buildClaudeCompactionSupplement([summaryRow]);
    expect(supplement.records.get(ANCHOR_UUID)).toEqual({ compactionId: ANCHOR_UUID });
  });

  it('drops nothing when the session never compacted', () => {
    const supplement = buildClaudeCompactionSupplement([convRow('user', 'u0')]);
    expect(supplement.droppedRows).toEqual([]);
    expect(supplement.records.size).toBe(0);
  });
});

describe('ClaudeCodeAdapter readHistory compaction', () => {
  const SESSION = 'session-compact';

  function row(type: 'user' | 'assistant', uuid: string, content: unknown): SessionMessage {
    return {
      type,
      uuid,
      session_id: SESSION,
      parent_tool_use_id: null,
      parent_agent_id: null,
      message: { content },
    };
  }

  class HistoryClaude extends ClaudeCodeAdapter {
    supplementReads = 0;

    constructor(
      private readonly messages: SessionMessage[],
      private readonly supplement: ClaudeCompactionSupplement,
    ) {
      super();
    }

    protected override loadSdk<T>(): Promise<T> {
      return Promise.resolve({
        getSessionInfo: () => Promise.resolve(undefined),
        getSessionMessages: () => Promise.resolve(this.messages),
        listSubagents: () => Promise.resolve([]),
      } as T);
    }

    protected override readCompactionSupplement(): Promise<ClaudeCompactionSupplement> {
      this.supplementReads += 1;
      return Promise.resolve(this.supplement);
    }
  }

  const record = {
    compactionId: BOUNDARY_UUID,
    trigger: 'auto' as const,
    preTokens: 10,
    postTokens: 2,
  };

  it('replays the summary row as a compaction marker, not a user prompt', async () => {
    const adapter = new HistoryClaude(
      [
        row('user', 'u0', [{ type: 'text', text: 'hello' }]),
        row('assistant', 'u1', [{ type: 'text', text: 'hi' }]),
        row('user', ANCHOR_UUID, 'Summary: everything so far.'),
        row('user', 'u2', [{ type: 'text', text: 'continue' }]),
      ],
      { records: new Map([[ANCHOR_UUID, record]]), droppedRows: [] },
    );
    const result = await adapter.readHistory({ historyId: asHistoryId(SESSION) });
    expect(result.events.map((e) => `${e.event.type}:${e.itemId ?? ''}`)).toEqual([
      'user-message:u0',
      'agent-message-chunk:u1',
      `compaction:${BOUNDARY_UUID}`,
      'user-message:u2',
    ]);
    const compaction = result.events[2].event;
    expect(compaction).toEqual({
      type: 'compaction',
      compactionId: BOUNDARY_UUID,
      trigger: 'auto',
      preTokens: 10,
      postTokens: 2,
      summary: 'Summary: everything so far.',
    });
  });

  it('prepends the pre-compaction rows the SDK drops, deduped against returned rows', async () => {
    const adapter = new HistoryClaude(
      // What the SDK returns post-compaction: summary head, preserved row, then the live tail.
      [
        row('user', ANCHOR_UUID, 'Summary: everything so far.'),
        row('assistant', 'kept', [{ type: 'text', text: 'preserved reply' }]),
        row('user', 'after', [{ type: 'text', text: 'continue' }]),
      ],
      {
        records: new Map([[ANCHOR_UUID, record]]),
        // The raw transcript's pre-boundary rows include the preserved row ('kept'), which the
        // SDK also returned — it must not appear twice.
        droppedRows: [
          row('user', 'pre0', [{ type: 'text', text: 'first prompt' }]),
          row('assistant', 'pre1', [{ type: 'text', text: 'first reply' }]),
          row('assistant', 'kept', [{ type: 'text', text: 'preserved reply' }]),
        ],
      },
    );
    const result = await adapter.readHistory({ historyId: asHistoryId(SESSION) });
    expect(result.events.map((e) => `${e.event.type}:${e.itemId ?? ''}`)).toEqual([
      'user-message:pre0',
      'agent-message-chunk:pre1',
      `compaction:${BOUNDARY_UUID}`,
      'agent-message-chunk:kept',
      'user-message:after',
    ]);
  });

  it('reads history unchanged when the session has no compactions', async () => {
    const adapter = new HistoryClaude([row('user', 'u0', [{ type: 'text', text: 'hello' }])], {
      records: new Map(),
      droppedRows: [],
    });
    const result = await adapter.readHistory({ historyId: asHistoryId(SESSION) });
    expect(result.events.map((e) => e.event.type)).toEqual(['user-message']);
  });

  it('skips the transcript read on pages after the first', async () => {
    const adapter = new HistoryClaude([row('user', 'u0', [{ type: 'text', text: 'hello' }])], {
      records: new Map([[ANCHOR_UUID, record]]),
      droppedRows: [],
    });
    await adapter.readHistory({ historyId: asHistoryId(SESSION) });
    expect(adapter.supplementReads).toBe(1);
    await adapter.readHistory({ historyId: asHistoryId(SESSION), cursor: '1000' });
    expect(adapter.supplementReads).toBe(1);
  });
});
