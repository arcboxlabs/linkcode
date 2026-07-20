import type {
  AgentCommand,
  AgentEvent,
  ContentBlock,
  EffortLevel,
  ToolCallUpdate,
} from '@linkcode/schema';
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
  commands(catalog: AgentCommand[]): void {
    this.emitCommands(catalog);
  }
  askQuestion(): Promise<unknown> {
    return this.requestQuestion({ toolCallId: 't1' }, [
      {
        questionId: 'q0',
        prompt: 'Which one?',
        multiSelect: false,
        options: [
          { optionId: 'o0', label: 'A' },
          { optionId: 'o1', label: 'B' },
        ],
      },
    ]);
  }
}

class EffortTestAdapter extends TestAdapter {
  readonly lifecycle: string[] = [];

  protected override onSetEffort(effort: EffortLevel): Promise<void> {
    this.lifecycle.push(`effort:${effort}`);
    this.emitEffort(effort);
    return Promise.resolve();
  }

  protected override onStart(): Promise<void> {
    this.lifecycle.push('start');
    return Promise.resolve();
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
    expect(a.seen.some((e) => e.type === 'permission-request')).toBe(true);

    await a.send({ type: 'cancel' });
    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('on cancel: resolves a pending question ask with cancelled (no hang/leak)', async () => {
    const a = new TestAdapter();
    const pending = a.askQuestion();
    expect(a.seen.some((e) => e.type === 'question-request')).toBe(true);

    await a.send({ type: 'cancel' });
    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
  });
});

describe('BaseAgentAdapter question round-trip', () => {
  it('resolves the pending ask with the answers from a question-response, by requestId', async () => {
    const a = new TestAdapter();
    const pending = a.askQuestion();
    const request = a.seen.find((e) => e.type === 'question-request');
    expect(request?.questions[0]).toMatchObject({ questionId: 'q0', prompt: 'Which one?' });

    const outcome = {
      outcome: 'answered' as const,
      answers: [{ questionId: 'q0', selectedOptionIds: ['o1'] }],
    };
    await a.send({ type: 'question-response', requestId: request!.requestId, outcome });
    await expect(pending).resolves.toEqual(outcome);
  });

  it('ignores a response for an unknown requestId', async () => {
    const a = new TestAdapter();
    const pending = a.askQuestion();
    await a.send({
      type: 'question-response',
      requestId: 'req-unknown',
      outcome: { outcome: 'cancelled' },
    });

    // Still pending: only teardown resolves it now.
    await a.send({ type: 'cancel' });
    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
  });
});

describe('BaseAgentAdapter command/shell defaults', () => {
  it('advertises its input capabilities at adapter start', async () => {
    const a = new TestAdapter();
    await a.start({ kind: 'pi', cwd: '/repo' });
    expect(a.seen).toContainEqual({
      type: 'capabilities-update',
      capabilities: { slashCommands: false, shellCommand: false },
    });
  });

  it('rejects a command input unless the adapter overrides onCommand', async () => {
    const a = new TestAdapter();
    await expect(a.send({ type: 'command', name: 'compact' })).rejects.toThrow(
      'pi: slash commands are not supported',
    );
  });

  it('rejects a shell-command input unless the adapter overrides onShellCommand', async () => {
    const a = new TestAdapter();
    await expect(a.send({ type: 'shell-command', command: 'ls' })).rejects.toThrow(
      'pi: shell commands are not supported',
    );
  });

  it('emitCommands emits the full-replace catalog event', () => {
    const a = new TestAdapter();
    a.commands([{ name: 'compact', description: 'Compact the context' }]);
    expect(a.seen.at(-1)).toEqual({
      type: 'available-commands-update',
      commands: [{ name: 'compact', description: 'Compact the context' }],
    });
  });
});

describe('BaseAgentAdapter initial effort', () => {
  it('validates and applies initial effort before starting the provider', async () => {
    const a = new EffortTestAdapter();
    await a.start({ kind: 'pi', cwd: '/repo', effort: 'high' });

    expect(a.lifecycle).toEqual(['effort:high', 'start']);
    expect(a.seen).toContainEqual({ type: 'effort-update', effort: 'high' });
  });

  it('rejects initial effort when the adapter does not support it', async () => {
    const a = new TestAdapter();
    await expect(a.start({ kind: 'pi', cwd: '/repo', effort: 'high' })).rejects.toThrow(
      'pi: changing effort is not supported',
    );
  });
});
