import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';
import { agentRuntimeProber } from '../probe';

let listener: ((event: AgentSessionEvent) => void) | undefined;
const prompt = vi.fn<AgentSession['prompt']>();

const session = {
  abort: vi.fn(),
  bindExtensions: vi.fn(),
  dispose: vi.fn(),
  get isStreaming() {
    return false;
  },
  prompt,
  subscribe: vi.fn((next: (event: AgentSessionEvent) => void) => {
    listener = next;
    return vi.fn();
  }),
};

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: { create: () => ({ setRuntimeApiKey: vi.fn() }) },
  DefaultResourceLoader: class {
    reload = vi.fn();
  },
  ModelRegistry: {
    create: () => ({
      find: vi.fn(),
      getAvailable: () => [{ provider: 'test', id: 'model' }],
      registerProvider: vi.fn(),
    }),
  },
  createAgentSession: () => Promise.resolve({ session }),
}));

function record(adapter: PiAdapter): AgentEvent[] {
  const events: AgentEvent[] = [];
  adapter.onEvent((event) => events.push(event));
  return events;
}

async function startedAdapter(): Promise<{ adapter: PiAdapter; events: AgentEvent[] }> {
  const adapter = new PiAdapter();
  const events = record(adapter);
  await adapter.start({ kind: 'pi', cwd: '/tmp/repo' });
  events.length = 0;
  return { adapter, events };
}

function assistant(stopReason: 'aborted' | 'error' | 'stop', errorMessage?: string): object {
  return { role: 'assistant', stopReason, errorMessage };
}

function emit(event: object): void {
  listener?.(event as AgentSessionEvent);
}

describe('PiAdapter lifecycle', () => {
  beforeEach(() => {
    listener = undefined;
    prompt.mockReset();
    vi.spyOn(agentRuntimeProber, 'resolveEntry').mockReturnValue(undefined);
  });

  it('unwinds a prompt rejected after announcing running', async () => {
    prompt.mockImplementationOnce(() => {
      emit({
        type: 'tool_execution_start',
        toolCallId: 'tool-rejected',
        toolName: 'read',
        args: { path: 'README.md' },
      });
      emit({ type: 'agent_settled' });
      return Promise.reject(new Error('dispatch failed'));
    });
    const { adapter, events } = await startedAdapter();

    await expect(
      adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] }),
    ).rejects.toThrow('dispatch failed');

    expect(events.filter((event) => event.type === 'status')).toEqual([
      { type: 'status', status: 'running' },
      { type: 'status', status: 'idle' },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCall: expect.objectContaining({ toolCallId: 'tool-rejected', status: 'failed' }),
      }),
    );
  });

  it('advertises and switches its approval policies', async () => {
    const adapter = new PiAdapter();
    const events = record(adapter);

    await adapter.start({ kind: 'pi', cwd: '/tmp/repo' });

    expect(events).toContainEqual({
      type: 'approval-policy-update',
      state: {
        availablePolicies: [
          {
            policyId: 'default',
            name: 'Ask permissions',
            description: 'Ask before edits, commands, and unrecognized tools.',
          },
          {
            policyId: 'acceptEdits',
            name: 'Accept edits',
            description: 'Apply edits without asking; ask for commands and other tools.',
          },
          {
            policyId: 'bypassPermissions',
            name: 'Bypass',
            description: 'Run every tool without asking.',
          },
        ],
        currentPolicyId: 'default',
      },
    });
    await adapter.send({ type: 'set-approval-policy', policyId: 'acceptEdits' });
    expect(events.at(-1)).toEqual({
      type: 'approval-policy-update',
      state: {
        availablePolicies: expect.any(Array),
        currentPolicyId: 'acceptEdits',
      },
    });
  });

  it('waits through retrying ends and settles successful turns exactly once', async () => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });
    emit({ type: 'agent_end', messages: [assistant('error', 'retry me')], willRetry: true });

    expect(events).toEqual([{ type: 'status', status: 'running' }]);

    emit({ type: 'agent_end', messages: [assistant('stop')], willRetry: false });
    emit({ type: 'agent_settled' });
    emit({ type: 'agent_settled' });

    expect(events).toEqual([
      { type: 'status', status: 'running' },
      { type: 'stop', stopReason: 'end_turn' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('keeps a retryable error as the final outcome when no later attempt runs', async () => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });
    emit({ type: 'agent_end', messages: [assistant('error', 'retry cancelled')], willRetry: true });
    emit({ type: 'agent_settled' });

    expect(events).toContainEqual({
      type: 'error',
      message: 'retry cancelled',
      recoverable: true,
    });
    expect(events.some((event) => event.type === 'stop')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it.each([
    {
      outcome: assistant('aborted'),
      finalEvent: { type: 'stop', stopReason: 'cancelled' },
    },
    {
      outcome: assistant('error', 'provider exploded'),
      finalEvent: { type: 'error', message: 'provider exploded', recoverable: true },
    },
  ])('maps the final assistant outcome at settlement', async ({ outcome, finalEvent }) => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });

    emit({ type: 'agent_end', messages: [outcome], willRetry: false });
    emit({ type: 'agent_settled' });

    expect(events).toContainEqual(finalEvent);
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it('settles a cancellation during retry backoff only when the session reports agent_settled', async () => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });
    emit({ type: 'agent_end', messages: [assistant('error', 'retry me')], willRetry: true });
    await adapter.send({ type: 'cancel' });
    events.length = 0;

    emit({ type: 'agent_settled' });

    expect(events).toEqual([
      { type: 'stop', stopReason: 'cancelled' },
      { type: 'status', status: 'idle' },
    ]);
  });

  it('fails an unfinished tool at final settlement', async () => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });
    emit({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'README.md' },
    });

    emit({ type: 'agent_end', messages: [assistant('stop')], willRetry: false });
    emit({ type: 'agent_settled' });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool-call',
        toolCall: expect.objectContaining({ toolCallId: 'tool-1', status: 'failed' }),
      }),
    );
  });
});
