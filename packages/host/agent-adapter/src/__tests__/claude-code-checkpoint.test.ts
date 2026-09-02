import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryCheckpoint } from '../history-branch';
import { encodeHistoryBranchCursor, HistoryCheckpointInvalidError } from '../history-branch';
import { asHistoryId } from '../history-util';
import type { ClaudeTranscriptSupplement } from '../native/claude-code';
import { ClaudeCodeAdapter } from '../native/claude-code';

/**
 * Fork checkpoints (CODE-632/633): the cut claude's `forkSession` needs is the uuid of the row the
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

  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }

  protected override loadSdk<T>(): Promise<T> {
    return Promise.resolve({ forkSession: this.forkSession } as T);
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

function assistantFrame(uuid: string, parentToolUseId: string | null = null): object {
  return {
    type: 'assistant',
    session_id: SESSION,
    uuid,
    parent_tool_use_id: parentToolUseId,
    message: {
      id: `api-${uuid}`,
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

  it('mints nothing for a failed result', () => {
    const { adapter, checkpoints } = harness();

    adapter.feed(assistantFrame('row-a'));
    adapter.feed(resultFrame('error_during_execution'));

    expect(checkpoints).toEqual([]);
  });
});

describe('ClaudeCodeAdapter.branchHistory checkpoint validity', () => {
  const start: StartOptions = { kind: 'claude-code', cwd: '/repo' };

  it('forks through the checkpoint row when the transcript still has it', async () => {
    const adapter = new TestClaude();
    adapter.supplementUuids = ['row-a', 'row-b'];

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
