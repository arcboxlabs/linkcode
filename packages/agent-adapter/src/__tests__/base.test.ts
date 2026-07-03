import type { AgentEvent, ContentBlock, ToolCallUpdate } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { BaseAgentAdapter } from '../base';

/** Minimal concrete adapter that exposes the protected emit/permission surface for testing. */
class TestAdapter extends BaseAgentAdapter {
  readonly kind = 'pi' as const;
  readonly seen: AgentEvent[] = [];

  constructor() {
    super();
    this.onEvent((e) => this.seen.push(e));
  }

  protected onStart(): Promise<void> {
    return Promise.resolve();
  }
  protected onPrompt(_content: ContentBlock[]): Promise<void> {
    return Promise.resolve();
  }

  tool(patch: ToolCallUpdate): void {
    this.emitTool(patch);
  }
  ask(): Promise<unknown> {
    return this.requestPermission({ toolCallId: 't1' }, [
      { optionId: 'ok', name: 'Allow', kind: 'allow_once' },
    ]);
  }
}

function toolEvents(a: TestAdapter): Array<Extract<AgentEvent, { type: 'tool-call' }>> {
  return a.seen.filter(
    (e): e is Extract<AgentEvent, { type: 'tool-call' }> => e.type === 'tool-call',
  );
}

describe('BaseAgentAdapter.emitTool', () => {
  it('emits a full snapshot, merging partial patches over the running state', () => {
    const a = new TestAdapter();
    a.tool({ toolCallId: 't1', title: 'Read', kind: 'read', status: 'in_progress' });
    a.tool({ toolCallId: 't1', status: 'completed', rawOutput: 'done' });

    const tools = toolEvents(a);
    expect(tools).toHaveLength(2);
    // Each event is a complete ToolCall; the second carries the merged title/kind from the first.
    expect(tools[1].toolCall).toMatchObject({
      toolCallId: 't1',
      title: 'Read',
      kind: 'read',
      status: 'completed',
      rawOutput: 'done',
    });
  });

  it('fills defaults on first sight (title=id, kind=other, status=in_progress, content=[])', () => {
    const a = new TestAdapter();
    a.tool({ toolCallId: 't9' });
    expect(toolEvents(a)[0].toolCall).toEqual({
      toolCallId: 't9',
      title: 't9',
      kind: 'other',
      status: 'in_progress',
      content: [],
      locations: undefined,
      rawInput: undefined,
      rawOutput: undefined,
    });
  });

  it('ignores updates to a tool that already reached a terminal state', () => {
    const a = new TestAdapter();
    a.tool({ toolCallId: 't1', title: 'Run', kind: 'execute', status: 'completed' });
    const before = a.seen.length;
    a.tool({ toolCallId: 't1', status: 'in_progress' }); // late/stray update — must be dropped
    expect(a.seen.length).toBe(before);
  });
});

describe('BaseAgentAdapter teardown', () => {
  it('on stop: finalizes non-terminal tools to failed, then emits stopped', async () => {
    const a = new TestAdapter();
    a.tool({ toolCallId: 't1', title: 'Run', kind: 'execute', status: 'in_progress' });
    await a.stop();

    const lastForT1 = toolEvents(a).findLast((e) => e.toolCall.toolCallId === 't1');
    expect(lastForT1?.toolCall.status).toBe('failed');
    expect(a.seen.some((e) => e.type === 'status' && e.status === 'stopped')).toBe(true);
  });

  it('on cancel: finalizes in-progress tools to failed', async () => {
    const a = new TestAdapter();
    a.tool({ toolCallId: 't1', title: 'Run', kind: 'execute', status: 'in_progress' });
    await a.send({ type: 'cancel' });

    expect(
      toolEvents(a).some((e) => e.toolCall.toolCallId === 't1' && e.toolCall.status === 'failed'),
    ).toBe(true);
  });

  it('on cancel: resolves a pending permission ask with cancelled (no hang/leak)', async () => {
    const a = new TestAdapter();
    const pending = a.ask();
    const request = a.seen.find((e) => e.type === 'permission-request');
    if (request?.type !== 'permission-request') throw new Error('permission request not emitted');

    await a.send({ type: 'cancel' });
    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
    expect(a.seen).toContainEqual({
      type: 'permission-resolved',
      requestId: request.requestId,
      outcome: { outcome: 'cancelled' },
    });
  });

  it('on cancel: sweeps a pending ask and an in-progress tool together', async () => {
    const a = new TestAdapter();
    a.tool({ toolCallId: 't1', title: 'Run', kind: 'execute', status: 'in_progress' });
    const pending = a.ask();

    await a.send({ type: 'cancel' });
    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
    expect(a.seen.some((e) => e.type === 'permission-resolved')).toBe(true);
    expect(
      toolEvents(a).some((e) => e.toolCall.toolCallId === 't1' && e.toolCall.status === 'failed'),
    ).toBe(true);
  });
});

describe('BaseAgentAdapter permission round-trip', () => {
  it('a permission-response settles the ask and emits permission-resolved with the outcome', async () => {
    const a = new TestAdapter();
    const pending = a.ask();
    const request = a.seen.find((e) => e.type === 'permission-request');
    if (request?.type !== 'permission-request') throw new Error('permission request not emitted');

    const outcome = { outcome: 'selected', optionId: 'ok' } as const;
    await a.send({ type: 'permission-response', requestId: request.requestId, outcome });
    await expect(pending).resolves.toEqual(outcome);
    expect(a.seen).toContainEqual({
      type: 'permission-resolved',
      requestId: request.requestId,
      outcome,
    });

    // A second response for the already-settled ask must be a silent no-op.
    await a.send({
      type: 'permission-response',
      requestId: request.requestId,
      outcome: { outcome: 'cancelled' },
    });
    expect(a.seen.filter((e) => e.type === 'permission-resolved')).toHaveLength(1);
  });

  it('an unknown or already-settled requestId emits nothing', async () => {
    const a = new TestAdapter();
    const before = a.seen.length;
    await a.send({
      type: 'permission-response',
      requestId: 'nope',
      outcome: { outcome: 'selected', optionId: 'ok' },
    });
    expect(a.seen.length).toBe(before);
  });
});
