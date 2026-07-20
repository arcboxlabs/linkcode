import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentEvent } from '@linkcode/schema';
import { asyncNoop, noop as noopFn } from 'foxts/noop';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';
import { agentRuntimeProber } from '../probe';

// Retry-aware turn finalization (CODE-342): pi emits an intermediate `agent_end {willRetry}` per
// attempt and a single `agent_settled` once the whole turn (all retries) is done. The approval
// axis and model/effort surfaces are exercised by their own pi-*.test.ts suites.

const FAKE_MODEL = { provider: 'test', id: 'model', reasoning: false };

let listener: ((event: AgentSessionEvent) => void) | undefined;
const prompt = vi.fn(asyncNoop);

vi.mock('@earendil-works/pi-coding-agent', () => {
  class FakeSession {
    isStreaming = false;
    sessionId = 'sess-1';
    prompt = prompt as unknown as () => Promise<void>;
    abort = asyncNoop;
    dispose = noopFn;
    bindExtensions = asyncNoop;
    subscribe(next: (event: AgentSessionEvent) => void) {
      listener = next;
      return noopFn;
    }
  }
  return {
    createAgentSession: () => Promise.resolve({ session: new FakeSession() }),
    AuthStorage: { create: () => ({ setRuntimeApiKey: noopFn }) },
    ModelRegistry: {
      create: () => ({
        getAvailable: () => [FAKE_MODEL],
        find: () => FAKE_MODEL,
        registerProvider: noopFn,
      }),
    },
    DefaultResourceLoader: class {
      reload() {
        return Promise.resolve();
      }
    },
  };
});

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

describe('PiAdapter retry finalization', () => {
  beforeEach(() => {
    listener = undefined;
    prompt.mockReset();
    prompt.mockResolvedValue(undefined);
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

  it('waits through retrying ends and settles a successful turn exactly once', async () => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });
    emit({ type: 'agent_end', messages: [assistant('error', 'retry me')], willRetry: true });

    expect(events.filter((event) => event.type === 'stop')).toHaveLength(0);

    emit({ type: 'agent_end', messages: [assistant('stop')], willRetry: false });
    emit({ type: 'agent_settled' });
    emit({ type: 'agent_settled' });

    expect(events.filter((event) => event.type === 'stop')).toEqual([
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it('keeps a retryable error as the final outcome when no later attempt runs', async () => {
    const { adapter, events } = await startedAdapter();
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hello' }] });
    emit({ type: 'agent_end', messages: [assistant('error', 'retry cancelled')], willRetry: true });
    emit({ type: 'agent_settled' });

    expect(events).toContainEqual({
      type: 'error',
      message: 'pi: retry cancelled',
      recoverable: true,
    });
    expect(events.some((event) => event.type === 'stop')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
  });

  it.each([
    { outcome: assistant('aborted'), finalEvent: { type: 'stop', stopReason: 'cancelled' } },
    {
      outcome: assistant('error', 'provider exploded'),
      finalEvent: { type: 'error', message: 'pi: provider exploded', recoverable: true },
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
