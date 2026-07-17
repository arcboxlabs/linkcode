import type { AgentEvent } from '@linkcode/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

const FAKE_MODEL = { provider: 'openai', id: 'gpt-test', reasoning: true };

type ToolCallHandler = (event: {
  type: 'tool_call';
  toolName: string;
  toolCallId: string;
  input: unknown;
}) => Promise<{ block?: boolean; reason?: string } | undefined>;

const sdkMock = vi.hoisted(() => ({
  toolCallHandler: null as ToolCallHandler | null,
  loaderOpts: null as Record<string, unknown> | null,
}));

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const { asyncNoop, noop: noopFn } = await import('foxts/noop');
  class FakeSession {
    isStreaming = false;
    sessionId = 'sess-1';
    prompt = asyncNoop;
    abort = asyncNoop;
    dispose = noopFn;
    bindExtensions = asyncNoop;
    subscribe() {
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
      private readonly factories: Array<(ext: unknown) => void>;
      constructor(opts: { extensionFactories?: Array<(ext: unknown) => void> }) {
        sdkMock.loaderOpts = opts;
        this.factories = opts.extensionFactories ?? [];
      }
      reload() {
        const ext = {
          on(name: string, handler: ToolCallHandler) {
            if (name === 'tool_call') sdkMock.toolCallHandler = handler;
          },
        };
        for (const factory of this.factories) factory(ext);
        return Promise.resolve();
      }
    },
  };
});

function permissionAsks(events: AgentEvent[]) {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'permission-request' }> =>
      e.type === 'permission-request',
  );
}
function policyUpdates(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'approval-policy-update' ? [e.state] : []));
}
function toolCallEvents(events: AgentEvent[]) {
  return events.flatMap((e) => (e.type === 'tool-call' ? [e.toolCall] : []));
}

async function startedAdapter() {
  const adapter = new PiAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'pi', cwd: '/tmp/pi-test' });
  const gate = sdkMock.toolCallHandler;
  if (!gate) throw new Error('tool_call gate was not registered');
  return { adapter, events, gate };
}

function toolEvent(toolName: string, toolCallId = 'call-1', input?: unknown) {
  return { type: 'tool_call' as const, toolName, toolCallId, input: input ?? { command: 'ls' } };
}

async function reply(
  adapter: PiAdapter,
  events: AgentEvent[],
  optionId: string | 'cancel',
): Promise<void> {
  await vi.waitFor(() => {
    expect(permissionAsks(events).length).toBeGreaterThan(0);
  });
  const ask = permissionAsks(events).at(-1)!;
  await adapter.send({
    type: 'permission-response',
    requestId: ask.requestId,
    outcome: optionId === 'cancel' ? { outcome: 'cancelled' } : { outcome: 'selected', optionId },
  });
}

beforeEach(() => {
  sdkMock.toolCallHandler = null;
  sdkMock.loaderOpts = null;
});

describe('pi approval gate', () => {
  it('advertises the policy axis at start with the Ask tier current', async () => {
    const { events } = await startedAdapter();
    const state = policyUpdates(events).at(-1)!;
    expect(state.currentPolicyId).toBe('default');
    expect(state.availablePolicies.map((p) => p.policyId)).toEqual([
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
    expect(sdkMock.loaderOpts).toHaveProperty('agentDir');
  });

  it('lets read-only tools through without asking under the Ask tier', async () => {
    const { events, gate } = await startedAdapter();
    await expect(gate(toolEvent('read'))).resolves.toBeUndefined();
    await expect(gate(toolEvent('grep'))).resolves.toBeUndefined();
    expect(permissionAsks(events)).toHaveLength(0);
  });

  it('asks for a command and blocks on rejection with a failed tool card', async () => {
    const { adapter, events, gate } = await startedAdapter();

    const gated = gate(toolEvent('bash', 'call-9'));
    await reply(adapter, events, 'reject');
    await expect(gated).resolves.toEqual({
      block: true,
      reason: 'The user declined this tool call',
    });

    const cards = toolCallEvents(events).filter((c) => c.toolCallId === 'call-9');
    expect(cards.at(0)).toMatchObject({ status: 'in_progress', title: 'bash' });
    expect(cards.at(-1)).toMatchObject({ status: 'failed' });
    const ask = permissionAsks(events)[0];
    expect(ask.options.map((o) => o.kind)).toEqual(['allow_once', 'allow_always', 'reject_once']);
  });

  it('allows once, and allow-always stops asking for that tool this session', async () => {
    const { adapter, events, gate } = await startedAdapter();

    const first = gate(toolEvent('bash', 'call-1'));
    await reply(adapter, events, 'allow');
    await expect(first).resolves.toBeUndefined();

    const second = gate(toolEvent('bash', 'call-2'));
    await reply(adapter, events, 'allow-session');
    await expect(second).resolves.toBeUndefined();

    await expect(gate(toolEvent('bash', 'call-3'))).resolves.toBeUndefined();
    expect(permissionAsks(events)).toHaveLength(2);
  });

  it('switches tiers live via set-approval-policy and rejects unknown ids', async () => {
    const { adapter, events, gate } = await startedAdapter();

    await adapter.send({ type: 'set-approval-policy', policyId: 'acceptEdits' });
    expect(policyUpdates(events).at(-1)!.currentPolicyId).toBe('acceptEdits');
    await expect(gate(toolEvent('edit'))).resolves.toBeUndefined();

    await adapter.send({ type: 'set-approval-policy', policyId: 'bypassPermissions' });
    await expect(gate(toolEvent('bash'))).resolves.toBeUndefined();
    await expect(gate(toolEvent('someExtensionTool'))).resolves.toBeUndefined();
    expect(permissionAsks(events)).toHaveLength(0);

    await expect(adapter.send({ type: 'set-approval-policy', policyId: 'plan' })).rejects.toThrow(
      "pi: unknown approval policy 'plan'",
    );
  });

  it('still asks for commands and unknown tools under acceptEdits', async () => {
    const { adapter, events, gate } = await startedAdapter();
    await adapter.send({ type: 'set-approval-policy', policyId: 'acceptEdits' });

    const gated = gate(toolEvent('someExtensionTool', 'call-5'));
    await reply(adapter, events, 'reject');
    await expect(gated).resolves.toMatchObject({ block: true });
  });

  it('resolves a pending ask as a block when the turn is cancelled', async () => {
    const { adapter, events, gate } = await startedAdapter();
    const gated = gate(toolEvent('bash', 'call-7'));
    await vi.waitFor(() => {
      expect(permissionAsks(events)).toHaveLength(1);
    });
    await adapter.send({ type: 'cancel' });
    await expect(gated).resolves.toEqual({
      block: true,
      reason: 'Tool call cancelled by the user',
    });
    // teardown swept the announced card to failed.
    const cards = toolCallEvents(events).filter((c) => c.toolCallId === 'call-7');
    expect(cards.at(-1)).toMatchObject({ status: 'failed' });
  });
});
