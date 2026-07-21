import type { AgentEvent } from '@linkcode/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

type Gate = (event: {
  type: 'tool_call';
  toolName: string;
  toolCallId: string;
  input: unknown;
}) => Promise<{ block?: boolean; reason?: string } | undefined>;

const sdk = vi.hoisted(() => ({
  abort: vi.fn<() => Promise<void>>(),
  gate: null as Gate | null,
}));
vi.mock('@earendil-works/pi-coding-agent', async () => {
  const { asyncNoop, noop } = await import('foxts/noop');
  return {
    AuthStorage: { create: () => ({ setRuntimeApiKey: noop }) },
    ModelRegistry: {
      create: () => ({
        find: vi.fn(),
        getAvailable: () => [{ provider: 'test', id: 'model', reasoning: false }],
        registerProvider: noop,
      }),
    },
    DefaultResourceLoader: class {
      constructor(
        private readonly options: { extensionFactories?: Array<(api: unknown) => void> },
      ) {}
      reload() {
        for (const factory of this.options.extensionFactories ?? []) {
          factory({
            on(_name: string, handler: Gate) {
              sdk.gate = handler;
            },
          });
        }
        return Promise.resolve();
      }
    },
    createAgentSession: () =>
      Promise.resolve({
        session: {
          abort: () => sdk.abort(),
          bindExtensions: asyncNoop,
          dispose: noop,
          isStreaming: false,
          model: { provider: 'test', id: 'model', reasoning: false },
          prompt: asyncNoop,
          sessionId: 'session',
          subscribe: () => noop,
          thinkingLevel: 'off',
        },
      }),
  };
});

function requests(events: AgentEvent[]) {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: 'permission-request' }> =>
      event.type === 'permission-request',
  );
}
async function setup() {
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((event) => events.push(event));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi' });
  if (!sdk.gate) throw new Error('gate not registered');
  return { adapter, events, gate: sdk.gate };
}
function call(id: string, toolName = 'bash') {
  return { type: 'tool_call' as const, toolName, toolCallId: id, input: { command: 'ls' } };
}
async function respond(adapter: PiAdapter, events: AgentEvent[], optionId?: string) {
  await vi.waitFor(() => expect(requests(events)).not.toHaveLength(0));
  const request = requests(events).at(-1)!;
  await adapter.send({
    type: 'permission-response',
    requestId: request.requestId,
    outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' },
  });
}

beforeEach(() => {
  sdk.abort.mockReset().mockResolvedValue();
  sdk.gate = null;
});

describe('Pi approval gate', () => {
  it('auto-allows safe tools and supports allow once and option id always', async () => {
    const { adapter, events, gate } = await setup();
    await expect(gate(call('safe', 'read'))).resolves.toBeUndefined();
    const once = gate(call('once'));
    await respond(adapter, events, 'allow');
    await expect(once).resolves.toBeUndefined();
    const always = gate(call('always-1'));
    await respond(adapter, events, 'always');
    await expect(always).resolves.toBeUndefined();
    await expect(gate(call('always-2'))).resolves.toBeUndefined();
    expect(requests(events)).toHaveLength(2);
    expect(requests(events)[0].options.map((option) => option.optionId)).toEqual([
      'allow',
      'always',
      'reject',
    ]);
  });

  it('blocks rejection and cancellation', async () => {
    const { adapter, events, gate } = await setup();
    const rejected = gate(call('reject'));
    await respond(adapter, events, 'reject');
    await expect(rejected).resolves.toEqual({
      block: true,
      reason: 'The user declined this tool call',
    });
    const cancelled = gate(call('cancel'));
    await respond(adapter, events);
    await expect(cancelled).resolves.toEqual({ block: true, reason: 'Tool call cancelled' });
    expect(events).toContainEqual({
      type: 'tool-call',
      toolCall: expect.objectContaining({ toolCallId: 'cancel', status: 'failed' }),
    });
  });

  it('invalidates queued callbacks on stop and clears always behavior', async () => {
    const first = await setup();
    const allowed = first.gate(call('grant'));
    await respond(first.adapter, first.events, 'always');
    await allowed;
    const staleGate = first.gate;
    await first.adapter.stop();
    const before = requests(first.events).length;
    await expect(staleGate(call('late'))).resolves.toEqual({
      block: true,
      reason: 'The Pi session has stopped',
    });
    expect(requests(first.events)).toHaveLength(before);

    const second = await setup();
    const pending = second.gate(call('new'));
    await vi.waitFor(() => expect(requests(second.events)).toHaveLength(1));
    // Pi's real abort waits for an in-flight extension gate before becoming idle. The adapter must
    // cancel that host round-trip before awaiting abort, or Stop and the gate deadlock each other.
    sdk.abort.mockImplementation(async () => {
      await pending;
    });
    await expect(second.adapter.send({ type: 'cancel' })).resolves.toBeUndefined();
    await expect(pending).resolves.toMatchObject({ block: true });
  });
});
