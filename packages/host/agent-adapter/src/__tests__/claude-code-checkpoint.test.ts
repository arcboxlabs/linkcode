import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryCheckpoint } from '../history-branch';
import { encodeHistoryBranchCursor, HistoryCheckpointInvalidError } from '../history-branch';
import { asHistoryId } from '../history-util';
import type { ClaudeTranscriptSupplement } from '../native/claude-code';
import { buildClaudeTranscriptSupplement, ClaudeCodeAdapter } from '../native/claude-code';

/**
 * Fork checkpoints: the cut claude's `forkSession` needs is the uuid of the row the
 * next user row hangs off — the turn's last main-agent assistant frame on a linear history — and
 * a fork must re-verify that row still exists in the raw transcript before cutting.
 */

const SESSION = 'sid-fork';

function forkedChild() {
  return Promise.resolve({ sessionId: 'sid-child' });
}

class TestClaude extends ClaudeCodeAdapter {
  forkSession = vi.fn(forkedChild);
  supplementUuids: string[] = [];
  started: StartOptions[] = [];
  subagentCopies: Array<[string, string]> = [];

  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }

  protected override loadSdk<T>(): Promise<T> {
    return Promise.resolve({ forkSession: this.forkSession } as T);
  }

  protected override copySubagentTranscripts(sourceId: string, childId: string): Promise<void> {
    this.subagentCopies.push([sourceId, childId]);
    return Promise.resolve();
  }

  protected override readTranscriptSupplement(): Promise<ClaudeTranscriptSupplement> {
    return Promise.resolve({
      records: new Map(),
      droppedRows: [],
      parentUuidByUuid: new Map(this.supplementUuids.map((uuid) => [uuid, null])),
      toolUses: new Map(),
      toolUseResults: new Map(),
      toolUsePatches: new Map(),
    });
  }

  protected override onStart(opts: StartOptions): Promise<void> {
    this.started.push(opts);
    return Promise.resolve();
  }
}

function assistantFrame(
  uuid: string,
  parentToolUseId: string | null = null,
  apiMessageId = `api-${uuid}`,
): object {
  return {
    type: 'assistant',
    session_id: SESSION,
    uuid,
    parent_tool_use_id: parentToolUseId,
    message: {
      id: apiMessageId,
      model: 'claude-test',
      content: [{ type: 'text', text: 'hi' }],
    },
  };
}

function resultFrame(subtype: 'success' | 'error_during_execution'): object {
  return {
    type: 'result',
    subtype,
    session_id: SESSION,
    uuid: `result-${subtype}`,
    stop_reason: 'end_turn',
    usage: {},
    total_cost_usd: 0,
    ...(subtype !== 'success' && { errors: ['boom'] }),
  };
}

function harness() {
  const adapter = new TestClaude();
  const events: AgentEvent[] = [];
  const checkpoints: HistoryCheckpoint[] = [];
  adapter.onEvent((event) => events.push(event));
  adapter.onCheckpoint((checkpoint) => {
    checkpoints.push(checkpoint);
    events.push({ type: 'title-update', title: 'checkpoint-marker' });
  });
  return { adapter, events, checkpoints };
}

describe('ClaudeCodeAdapter live fork checkpoints', () => {
  it('mints the last main-agent assistant uuid at a successful result, before the stop', () => {
    const { adapter, events, checkpoints } = harness();

    adapter.feed(assistantFrame('row-a'));
    adapter.feed(assistantFrame('row-b'));
    // A subagent frame is not a main-chain row: the next user row never hangs off it.
    adapter.feed(assistantFrame('row-sub', 'toolu_agent'));
    adapter.feed(resultFrame('success'));

    expect(checkpoints).toEqual([
      {
        historyId: SESSION,
        cursor: encodeHistoryBranchCursor('claude-code', asHistoryId(SESSION), 'row-b'),
        turn: 'ending',
      },
    ]);
    const marker = events.findIndex(
      (event) => event.type === 'title-update' && event.title === 'checkpoint-marker',
    );
    const stop = events.findIndex((event) => event.type === 'stop');
    expect(marker).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(marker);
  });

  it('mints the LAST frame of a multi-block API message — one frame per persisted row', () => {
    const { adapter, checkpoints } = harness();

    // The CLI persists one transcript row per content block, each with its own uuid, all sharing
    // the API `message.id`; the next user row hangs off the last of them.
    adapter.feed(assistantFrame('row-b1', null, 'api-multi'));
    adapter.feed(assistantFrame('row-b2', null, 'api-multi'));
    adapter.feed(resultFrame('success'));

    expect(checkpoints.map((checkpoint) => JSON.parse(checkpoint.cursor).branchPoint)).toEqual([
      'row-b2',
    ]);
  });

  it('mints nothing for a failed result', () => {
    const { adapter, checkpoints } = harness();

    adapter.feed(assistantFrame('row-a'));
    adapter.feed(resultFrame('error_during_execution'));

    expect(checkpoints).toEqual([]);
  });
});

describe('claude fork cuts across a Stop hook summary row', () => {
  const start: StartOptions = { kind: 'claude-code', cwd: '/repo' };
  const row = (value: object) => JSON.stringify(value);
  const transcript = [
    row({ type: 'user', uuid: 'u0', parentUuid: null, message: { role: 'user', content: 'q' } }),
    row({ type: 'assistant', uuid: 'row-a', parentUuid: 'u0', message: { role: 'assistant' } }),
    row({ type: 'system', subtype: 'stop_hook_summary', uuid: 'row-s', parentUuid: 'row-a' }),
    row({
      type: 'user',
      uuid: 'u1',
      parentUuid: 'row-s',
      message: { role: 'user', content: 'q2' },
    }),
  ];

  it('the cold-read cursor is the system row, the live checkpoint the assistant row — both cut', async () => {
    const supplement = buildClaudeTranscriptSupplement(transcript);
    expect(supplement.parentUuidByUuid.get('u1')).toBe('row-s');

    const cuts = ['row-s', 'row-a'];
    for (let i = 0, len = cuts.length; i < len; i++) {
      const cut = cuts[i];
      const adapter = new TestClaude();
      adapter.supplementUuids = [...supplement.parentUuidByUuid.keys()];
      // eslint-disable-next-line no-await-in-loop -- one fork per cut, sequential by construction
      await adapter.branchHistory(
        {
          historyId: asHistoryId(SESSION),
          cursor: encodeHistoryBranchCursor('claude-code', asHistoryId(SESSION), cut),
        },
        start,
      );
      expect(adapter.forkSession).toHaveBeenCalledWith(SESSION, {
        upToMessageId: cut,
        dir: '/repo',
      });
    }
  });
});

describe('ClaudeCodeAdapter.branchHistory checkpoint validity', () => {
  const start: StartOptions = { kind: 'claude-code', cwd: '/repo' };

  it('forks through the checkpoint row when the transcript still has it', async () => {
    const adapter = new TestClaude();
    adapter.supplementUuids = ['row-a', 'row-b'];
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.branchHistory(
      {
        historyId: asHistoryId(SESSION),
        cursor: encodeHistoryBranchCursor('claude-code', asHistoryId(SESSION), 'row-b'),
      },
      start,
    );

    expect(adapter.forkSession).toHaveBeenCalledWith(SESSION, {
      upToMessageId: 'row-b',
      dir: '/repo',
    });
    expect(adapter.started).toEqual([start]);
    // The child exists on disk before the first prompt: its subagents travel with it and its id is
    // announced at once, so a prompt-less fork can read its own history.
    expect(adapter.subagentCopies).toEqual([[SESSION, 'sid-child']]);
    expect(events).toContainEqual({ type: 'session-ref', historyId: 'sid-child' });
  });

  it('refuses typed, without forking or starting, when the row is gone (rewritten or deleted transcript)', async () => {
    const adapter = new TestClaude();
    adapter.supplementUuids = ['row-a'];

    await expect(
      adapter.branchHistory(
        {
          historyId: asHistoryId(SESSION),
          cursor: encodeHistoryBranchCursor('claude-code', asHistoryId(SESSION), 'row-b'),
        },
        start,
      ),
    ).rejects.toBeInstanceOf(HistoryCheckpointInvalidError);
    expect(adapter.forkSession).not.toHaveBeenCalled();
    expect(adapter.started).toEqual([]);
  });
});
