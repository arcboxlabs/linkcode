import type { AgentEvent, ApprovalPolicyState } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';
import type { QueryInput } from './claude-code-fake-query';
import { FakeQuery } from './claude-code-fake-query';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
}));

const queries: FakeQuery[] = [];

sdkMock.query = (opts) => {
  const q = new FakeQuery(opts as QueryInput);
  queries.push(q);
  return q;
};

afterEach(() => {
  queries.length = 0;
});

async function makeAdapter(): Promise<{ adapter: ClaudeCodeAdapter; events: AgentEvent[] }> {
  const adapter = new ClaudeCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'claude-code', cwd: '/tmp/repo' });
  return { adapter, events };
}

function prompt(adapter: ClaudeCodeAdapter): Promise<void> {
  return adapter.send({ type: 'prompt', content: [textBlock('hi')] });
}

function setPolicy(adapter: ClaudeCodeAdapter, policyId: string): Promise<void> {
  return adapter.send({ type: 'set-approval-policy', policyId });
}

function lastPolicyState(events: AgentEvent[]): ApprovalPolicyState | undefined {
  const event = events.findLast((e) => e.type === 'approval-policy-update');
  return event?.type === 'approval-policy-update' ? event.state : undefined;
}

describe('ClaudeCodeAdapter approval policy', () => {
  it('advertises the catalog with the default policy on start', async () => {
    const { events } = await makeAdapter();
    const state = lastPolicyState(events);
    expect(state?.currentPolicyId).toBe('default');
    expect(state?.availablePolicies.map((p) => p.policyId)).toEqual([
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
  });

  it('applies a pre-Query switch at spawn, with the bypass capability always granted', async () => {
    const { adapter, events } = await makeAdapter();
    await setPolicy(adapter, 'acceptEdits');
    expect(lastPolicyState(events)?.currentPolicyId).toBe('acceptEdits');

    await prompt(adapter);
    const q0 = queries[0];
    expect(q0.options.permissionMode).toBe('acceptEdits');
    expect(q0.options.allowDangerouslySkipPermissions).toBe(true);
    expect(q0.setPermissionMode).not.toHaveBeenCalled();
  });

  it('switches a live Query via setPermissionMode, committing only after acceptance', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];

    await setPolicy(adapter, 'bypassPermissions');
    expect(q0.setPermissionMode).toHaveBeenCalledWith('bypassPermissions');
    expect(lastPolicyState(events)?.currentPolicyId).toBe('bypassPermissions');

    // Re-picking the current policy is a no-op.
    await setPolicy(adapter, 'bypassPermissions');
    expect(q0.setPermissionMode).toHaveBeenCalledTimes(1);
  });

  it('keeps the old policy when the CLI rejects the switch', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];

    q0.setPermissionMode.mockRejectedValueOnce(new Error('nope'));
    await expect(setPolicy(adapter, 'bypassPermissions')).rejects.toThrow('nope');
    expect(lastPolicyState(events)?.currentPolicyId).toBe('default');
  });

  it('rejects an unknown policy id', async () => {
    const { adapter } = await makeAdapter();
    await expect(setPolicy(adapter, 'plan')).rejects.toThrow("unknown approval policy 'plan'");
  });

  it('re-syncs from the init handshake when the CLI reports a different mode', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q0 = queries[0];

    q0.push({ type: 'system', subtype: 'init', permissionMode: 'acceptEdits', session_id: 's1' });
    await vi.waitFor(() => {
      expect(lastPolicyState(events)?.currentPolicyId).toBe('acceptEdits');
    });
  });
});
