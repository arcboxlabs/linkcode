import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { asyncNoop } from 'foxts/noop';
import { wait } from 'foxts/wait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../native/claude-code';

const sdkMock = vi.hoisted(() => ({
  query: null as ((opts: unknown) => unknown) | null,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(opts: unknown) {
    if (!sdkMock.query) throw new Error('query mock not installed');
    return sdkMock.query(opts);
  },
}));

// Isolate `settingsDefaultMode` from the developer's real ~/.claude/settings.json: by default every
// settings read misses, so unit tests see a clean environment (policy stays 'default'). A test can
// seed `fsMock.files` (absolute path → JSON) to exercise the settings-default path.
const fsMock = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock('node:fs/promises', () => ({
  readFile(file: string) {
    const content = fsMock.files.get(file);
    return content === undefined
      ? Promise.reject(new Error(`ENOENT: ${file}`))
      : Promise.resolve(content);
  },
}));

interface QueryInput {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Record<string, unknown>;
}

/** The mocked module boundary erases the SDK's message union; the fake only needs runtime shape. */
type WireMessage = Record<string, unknown>;

/** Stands in for the SDK's `Query`: exposes the options it was created with and lets tests feed
 * messages into the adapter's consume() loop (see claude-code-effort.test.ts for the full fake). */
class FakeQuery {
  readonly options: Record<string, unknown>;
  readonly setPermissionMode = vi.fn<(mode: string) => Promise<void>>(asyncNoop);
  readonly applyFlagSettings =
    vi.fn<(settings: Record<string, unknown>) => Promise<void>>(asyncNoop);
  readonly close = vi.fn(() => {
    this.push(null);
  });
  private readonly buffered: Array<WireMessage | null> = [];
  private waiting: ((msg: WireMessage | null) => void) | null = null;

  constructor(input: QueryInput) {
    this.options = input.options;
    void (async () => {
      // Drain the streaming prompt like the real SDK read loop.
      for await (const _ of input.prompt) void _;
    })();
  }

  push(msg: WireMessage | null): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(msg);
    } else {
      this.buffered.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<WireMessage> {
    while (true) {
      const next =
        this.buffered.length > 0
          ? this.buffered.shift()!
          : // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-message signal
            await new Promise<WireMessage | null>((resolve) => {
              this.waiting = resolve;
            });
      if (next === null) return;
      yield next;
    }
  }
}

const queries: FakeQuery[] = [];

sdkMock.query = (opts) => {
  const q = new FakeQuery(opts as QueryInput);
  queries.push(q);
  return q;
};

afterEach(() => {
  queries.length = 0;
  fsMock.files.clear();
});

async function makeAdapter(cwd = '/tmp/repo'): Promise<{
  adapter: ClaudeCodeAdapter;
  events: AgentEvent[];
}> {
  const adapter = new ClaudeCodeAdapter();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start({ kind: 'claude-code', cwd });
  return { adapter, events };
}

function prompt(adapter: ClaudeCodeAdapter): Promise<void> {
  return adapter.send({ type: 'prompt', content: [textBlock('hi')] });
}

function setPolicy(adapter: ClaudeCodeAdapter, policyId: string): Promise<void> {
  return adapter.send({ type: 'set-approval-policy', policyId });
}

function policyUpdates(events: AgentEvent[]) {
  return events.filter((e) => e.type === 'approval-policy-update');
}

describe('ClaudeCodeAdapter approval policy', () => {
  it('advertises its policy list at start, with default active', async () => {
    const { events } = await makeAdapter();
    const updates = policyUpdates(events);
    expect(updates).toHaveLength(1);
    expect(updates[0].state.currentPolicyId).toBe('default');
    expect(updates[0].state.availablePolicies.map((p) => p.policyId)).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'auto',
      'bypassPermissions',
    ]);
  });

  it('honors permissions.defaultMode from settings.json at start (CLI does not)', async () => {
    fsMock.files.set(
      '/work/proj/.claude/settings.json',
      JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }),
    );
    const { adapter, events } = await makeAdapter('/work/proj');
    expect(policyUpdates(events).at(-1)?.state.currentPolicyId).toBe('acceptEdits');

    // The resolved default is passed to the Query so the CLI actually starts in that mode.
    await prompt(adapter);
    expect(queries[0].options.permissionMode).toBe('acceptEdits');
  });

  it('switches the live Query before the first prompt', async () => {
    const { adapter, events } = await makeAdapter();
    await setPolicy(adapter, 'auto');
    expect(policyUpdates(events).at(-1)?.state.currentPolicyId).toBe('auto');

    const q = queries[0];
    expect(q.options.permissionMode).toBeUndefined();
    expect(q.options.allowDangerouslySkipPermissions).toBe(true);
    expect(q.setPermissionMode).toHaveBeenCalledWith('auto');
  });

  it('switches live via setPermissionMode and reflects only on success', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q = queries[0];
    // No pick yet: the flag is omitted so the CLI's own default (settings.json) stays in charge.
    expect(q.options.permissionMode).toBeUndefined();

    await setPolicy(adapter, 'auto');
    expect(q.setPermissionMode).toHaveBeenCalledWith('auto');
    expect(policyUpdates(events).at(-1)?.state.currentPolicyId).toBe('auto');

    q.setPermissionMode.mockRejectedValueOnce(new Error('auto mode unavailable'));
    const updatesBefore = policyUpdates(events).length;
    await expect(setPolicy(adapter, 'bypassPermissions')).rejects.toThrow('auto mode unavailable');
    expect(policyUpdates(events)).toHaveLength(updatesBefore);
    expect(policyUpdates(events).at(-1)?.state.currentPolicyId).toBe('auto');
  });

  it('rejects ids outside the advertised list (dontAsk stays off the menu)', async () => {
    const { adapter } = await makeAdapter();
    await prompt(adapter);
    await expect(setPolicy(adapter, 'dontAsk')).rejects.toThrow('unknown approval policy');
    expect(queries[0].setPermissionMode).not.toHaveBeenCalled();
  });

  it('adopts the effective mode the CLI reports at init (settings-driven default)', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    queries[0].push({
      type: 'system',
      subtype: 'init',
      permissionMode: 'acceptEdits',
      session_id: 's1',
      uuid: 'u0',
    });
    await vi.waitFor(() => {
      expect(policyUpdates(events).at(-1)?.state.currentPolicyId).toBe('acceptEdits');
    });
  });

  it('settles an auto-denied tool call as failed with the decider reason', async () => {
    const { adapter, events } = await makeAdapter();
    await prompt(adapter);
    const q = queries[0];
    q.push({
      type: 'assistant',
      session_id: 's1',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'rm -rf /' } },
        ],
      },
    });
    // eslint-disable-next-line sukka/unicorn/prefer-single-call -- AsyncMessageQueue.push takes ONE message; the merge autofix silently drops this one
    q.push({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'toolu_1',
      decision_reason_type: 'classifier',
      decision_reason: 'Irreversible destructive command',
      message: 'Denied',
      uuid: 'u1',
      session_id: 's1',
    });
    await vi.waitFor(() => {
      const tool = events.findLast((e) => e.type === 'tool-call');
      expect(tool?.toolCall.status).toBe('failed');
      expect(tool?.toolCall.content).toEqual([
        { type: 'content', content: textBlock('Irreversible destructive command') },
      ]);
    });

    // The follow-up is_error tool_result must not reopen or rewrite the settled call.
    q.push({
      type: 'user',
      session_id: 's1',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'Denied' },
        ],
      },
    });
    await wait(0);
    const tool = events.findLast((e) => e.type === 'tool-call');
    expect(tool?.toolCall.content).toEqual([
      { type: 'content', content: textBlock('Irreversible destructive command') },
    ]);
  });
});
