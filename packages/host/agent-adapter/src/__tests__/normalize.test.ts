import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AgentInput, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { asHistoryId } from '../history-util';
import {
  ClaudeCodeAdapter,
  createClaudeHistoryEventMapper,
  mapClaudeStop,
  toolUseResultEnvelope,
} from '../native/claude-code';
import {
  CodexAdapter,
  decisionFromOutcome,
  diffContentFromUnified,
  mapCodexItemStatus,
  mapCodexTokenUsage,
} from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';
import { contentToText, toolKindFromName } from '../util';

describe('contentToText', () => {
  it('flattens text blocks and drops non-text', () => {
    expect(
      contentToText([
        { type: 'text', text: 'a' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });
});

describe('toolKindFromName', () => {
  it('maps common tool names to ACP tool kinds', () => {
    expect(toolKindFromName('Read')).toBe('read');
    expect(toolKindFromName('Edit')).toBe('edit');
    expect(toolKindFromName('Bash')).toBe('execute');
    expect(toolKindFromName('Grep')).toBe('search');
    expect(toolKindFromName('WebFetch')).toBe('fetch');
    expect(toolKindFromName('Mystery')).toBe('other');
  });
});

function row(
  type: 'user' | 'assistant',
  uuid: string,
  content: string | unknown[],
  parentToolUseId: string | null = null,
  extra?: { timestamp?: string; model?: string; messageId?: string },
): SessionMessage {
  return {
    type,
    uuid,
    session_id: 'h1',
    parent_tool_use_id: parentToolUseId,
    parent_agent_id: null,
    message: {
      content,
      ...(extra?.model && { model: extra.model }),
      ...(extra?.messageId && { id: extra.messageId }),
    },
    ...(extra?.timestamp && { timestamp: extra.timestamp }),
  };
}

describe('createClaudeHistoryEventMapper', () => {
  const historyId = asHistoryId('h1');

  it('replays a tool call as announce and settle snapshots under the provider tool_use id', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const announce = map(
      row('assistant', 'u1', [
        { type: 'text', text: 'let me read that' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file: 'a.ts' } },
      ]),
    );
    expect(announce.map((e) => e.event.type)).toEqual(['agent-message', 'tool-call']);
    expect(announce[1].itemId).toBe('toolu_1');
    if (announce[1].event.type === 'tool-call') {
      expect(announce[1].event.toolCall).toMatchObject({
        toolCallId: 'toolu_1',
        title: 'Read',
        kind: 'read',
        status: 'in_progress',
        rawInput: { file: 'a.ts' },
      });
    }

    const settle = map(
      row('user', 'u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body' }]),
    );
    // The synthetic tool-result row settles the call; it must not render as a user message.
    expect(settle.map((e) => e.event.type)).toEqual(['tool-call']);
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall).toMatchObject({
        toolCallId: 'toolu_1',
        title: 'Read',
        kind: 'read',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
        rawInput: { file: 'a.ts' },
      });
    }
  });

  it('marks is_error results failed and tolerates a settle whose announce is outside the page', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const settle = map(
      row('user', 'u1', [
        { type: 'tool_result', tool_use_id: 'toolu_9', is_error: true, content: 'denied' },
      ]),
    );
    expect(settle).toHaveLength(1);
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall).toMatchObject({
        toolCallId: 'toolu_9',
        title: 'toolu_9',
        kind: 'other',
        status: 'failed',
      });
    }
  });

  it('parses an Edit announce into diff content and keeps it ahead of the settle text', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const input = { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' };
    const announce = map(
      row('assistant', 'u1', [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input }]),
    );
    if (announce[0].event.type === 'tool-call') {
      expect(announce[0].event.toolCall.content).toEqual([
        { type: 'diff', change: 'modify', path: 'src/a.ts', oldText: 'a', newText: 'b' },
      ]);
    }

    const settle = map(
      row('user', 'u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'updated' }]),
    );
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall.content).toEqual([
        { type: 'diff', change: 'modify', path: 'src/a.ts', oldText: 'a', newText: 'b' },
        { type: 'content', content: { type: 'text', text: 'updated' } },
      ]);
    }
  });

  it('flattens a ToolSearch tool_reference settle into a name-per-line text block', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    map(
      row('assistant', 'u1', [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'ToolSearch',
          input: { query: 'select:WebFetch' },
        },
      ]),
    );
    const settle = map(
      row('user', 'u2', [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [
            { type: 'tool_reference', tool_name: 'WebFetch' },
            { type: 'tool_reference', tool_name: 'mcp__linear__get_issue' },
          ],
        },
      ]),
    );
    expect(settle).toHaveLength(1);
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall.content).toEqual([
        {
          type: 'content',
          content: { type: 'text', text: 'WebFetch\nmcp__linear__get_issue' },
        },
      ]);
    }
  });

  it('stamps ts from the row timestamp and replays the served model as model-update', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const at = '2026-07-16T12:00:00.000Z';
    const first = map(
      row('assistant', 'u1', [{ type: 'text', text: 'hello' }], null, {
        timestamp: at,
        model: 'claude-opus-4-8',
      }),
    );
    expect(first.map((e) => `${e.event.type}@${e.ts ?? ''}`)).toEqual([
      `model-update@${Date.parse(at)}`,
      `agent-message@${Date.parse(at)}`,
    ]);
    if (first[0].event.type === 'model-update') {
      expect(first[0].event.model).toBe('claude-opus-4-8');
    }

    // Same model on the next row: no repeat announcement.
    const second = map(
      row('assistant', 'u2', [{ type: 'text', text: 'more' }], null, {
        model: 'claude-opus-4-8',
      }),
    );
    expect(second.map((e) => e.event.type)).toEqual(['agent-message']);

    // A switch re-announces; a subagent row's model never does.
    const switched = map(
      row('assistant', 'u3', [{ type: 'text', text: 'switched' }], null, {
        model: 'claude-sonnet-5',
      }),
    );
    expect(switched.map((e) => e.event.type)).toEqual(['model-update', 'agent-message']);
    const subagent = map(
      row('assistant', 'u4', [{ type: 'text', text: 'sub' }], 'toolu_task', {
        model: 'claude-haiku-4-5',
      }),
    );
    expect(subagent.map((e) => e.event.type)).toEqual(['agent-message']);
  });

  it('stamps ts on user prompts and tool settles', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const at = '2026-07-16T12:34:56.000Z';
    const prompt = map(row('user', 'u1', 'fix the bug', null, { timestamp: at }));
    expect(prompt[0].ts).toBe(Date.parse(at));

    map(row('assistant', 'u2', [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }]));
    const settle = map(
      row('user', 'u3', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'body' }], null, {
        timestamp: at,
      }),
    );
    expect(settle[0].ts).toBe(Date.parse(at));
  });

  it('keeps plain user prompts and assistant text as message events', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const prompt = map(row('user', 'u1', 'fix the bug'));
    expect(prompt.map((e) => e.event.type)).toEqual(['user-message']);
    expect(prompt[0].event).toMatchObject({ messageId: 'u1' });

    const reply = map(row('assistant', 'u2', [{ type: 'text', text: 'done' }]));
    expect(reply.map((e) => e.event.type)).toEqual(['agent-message']);
  });

  it('replays thinking and text under the provider message id used by the live stream', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const events = map(
      row(
        'assistant',
        'u1',
        [
          { type: 'thinking', thinking: 'let me reason', signature: 'sig' },
          { type: 'text', text: 'the answer' },
        ],
        null,
        { messageId: 'provider-message' },
      ),
    );
    expect(events.map((e) => e.event.type)).toEqual(['agent-thought', 'agent-message']);
    expect(events[0].event).toMatchObject({
      messageId: 'provider-message:think',
      content: [{ type: 'text', text: 'let me reason' }],
    });
    expect(events[1].event).toMatchObject({
      messageId: 'provider-message',
      content: [{ type: 'text', text: 'the answer' }],
    });
  });

  it('drops empty thinking blocks (pre-CODE-273 transcripts store empty text)', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const events = map(
      row('assistant', 'u1', [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: 'done' },
      ]),
    );
    expect(events.map((e) => e.event.type)).toEqual(['agent-message']);
  });

  it('stamps parentToolCallId on subagent thinking so it renders inside the subagent card', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const events = map(
      row('assistant', 'u1', [{ type: 'thinking', thinking: 'child reasoning' }], 'toolu_task'),
    );
    expect(events.map((e) => e.event.type)).toEqual(['agent-thought']);
    expect(events[0].event).toMatchObject({
      messageId: 'u1:think',
      parentToolCallId: 'toolu_task',
    });
  });

  it('stamps parentToolCallId on subagent rows and classifies Task as task-kind', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const announce = map(
      row('assistant', 'u1', [
        { type: 'tool_use', id: 'toolu_task', name: 'Task', input: { description: 'explore' } },
      ]),
    );
    if (announce[0].event.type === 'tool-call') {
      expect(announce[0].event.toolCall).toMatchObject({ kind: 'task', toolCallId: 'toolu_task' });
    }

    const subText = map(
      row('assistant', 'u2', [{ type: 'text', text: 'looking around' }], 'toolu_task'),
    );
    expect(subText[0].event).toMatchObject({
      type: 'agent-message',
      parentToolCallId: 'toolu_task',
    });

    const subTool = map(
      row(
        'assistant',
        'u3',
        [{ type: 'tool_use', id: 'toolu_sub', name: 'Read', input: {} }],
        'toolu_task',
      ),
    );
    if (subTool[0].event.type === 'tool-call') {
      expect(subTool[0].event.toolCall.parentToolCallId).toBe('toolu_task');
    }

    const subSettle = map(
      row(
        'user',
        'u4',
        [{ type: 'tool_result', tool_use_id: 'toolu_sub', content: 'ok' }],
        'toolu_task',
      ),
    );
    if (subSettle[0].event.type === 'tool-call') {
      expect(subSettle[0].event.toolCall).toMatchObject({
        status: 'completed',
        parentToolCallId: 'toolu_task',
      });
    }
  });

  it('skips the injected subagent prompt on subagent user rows', () => {
    const map = createClaudeHistoryEventMapper(historyId);
    const events = map(row('user', 'u1', 'map the repo structure', 'toolu_task'));
    expect(events).toEqual([]);
  });
});

class TestClaude extends ClaudeCodeAdapter {
  feed(value: object): void {
    this.handleMessage(value as SDKMessage);
  }
}

function toolSnapshots(events: AgentEvent[]) {
  return events.filter(
    (e): e is Extract<AgentEvent, { type: 'tool-call' }> => e.type === 'tool-call',
  );
}

describe('toolUseResultEnvelope', () => {
  it('keeps small scalars and drops payload fields', () => {
    expect(
      toolUseResultEnvelope({
        bytes: 192511,
        code: 200,
        codeText: 'OK',
        durationMs: 5404,
        url: 'https://en.wikipedia.org/wiki/Arknights',
        result: 'fetched page text — '.repeat(20),
        file: { content: 'whole file' },
        matches: ['a', 'b'],
        interrupted: false,
      }),
    ).toEqual({
      bytes: 192511,
      code: 200,
      codeText: 'OK',
      durationMs: 5404,
      url: 'https://en.wikipedia.org/wiki/Arknights',
      interrupted: false,
    });
  });

  it('returns undefined for strings, arrays, and all-payload records', () => {
    expect(toolUseResultEnvelope('String to replace not found')).toBeUndefined();
    expect(toolUseResultEnvelope(['a'])).toBeUndefined();
    expect(
      toolUseResultEnvelope({ file: { content: 'x' }, stdout: 'y'.repeat(300) }),
    ).toBeUndefined();
  });
});

describe('ClaudeCodeAdapter Edit diff normalization', () => {
  it('announces the Edit diff and keeps it through the settle', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Edit',
            input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' },
          },
        ],
      },
    });
    adapter.feed({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'updated' }] },
    });

    const diff = {
      type: 'diff',
      change: 'modify',
      path: 'src/a.ts',
      oldText: 'a',
      newText: 'b',
    };
    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolCall.content).toEqual([diff]);
    expect(tools[1].toolCall.status).toBe('completed');
    expect(tools[1].toolCall.content).toEqual([
      diff,
      { type: 'content', content: { type: 'text', text: 'updated' } },
    ]);
    expect(seen).toContainEqual({
      type: 'tool-call-content-chunk',
      toolCallId: 't1',
      content: { type: 'content', content: { type: 'text', text: 'updated' } },
    });
  });

  it('projects the live tool_use_result envelope onto the settle rawOutput', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'WebFetch', input: { url: 'https://a.test' } },
        ],
      },
    });
    adapter.feed({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '# Page' }] },
      tool_use_result: {
        bytes: 9,
        code: 200,
        codeText: 'OK',
        durationMs: 12,
        result: 'fetched page text — '.repeat(20),
        url: 'https://a.test',
      },
    });

    const tools = toolSnapshots(seen);
    expect(tools[1].toolCall.rawOutput).toEqual({
      bytes: 9,
      code: 200,
      codeText: 'OK',
      durationMs: 12,
      url: 'https://a.test',
    });
    expect(tools[1].toolCall.content).toEqual([
      { type: 'content', content: { type: 'text', text: '# Page' } },
    ]);
  });

  it('parses a Write announce into a whole-file diff without oldText', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Write',
            input: { file_path: 'src/new.ts', content: 'export const a = 1;\n' },
          },
        ],
      },
    });

    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(1);
    expect(tools[0].toolCall.content).toEqual([
      {
        type: 'diff',
        change: 'add',
        path: 'src/new.ts',
        newText: 'export const a = 1;\n',
      },
    ]);
  });

  it('leaves non-Edit tools and malformed Edit inputs as raw passthrough', () => {
    const adapter = new TestClaude();
    const seen: AgentEvent[] = [];
    adapter.onEvent((e) => seen.push(e));

    adapter.feed({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.ts' } },
          { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/a.ts' } },
        ],
      },
    });

    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolCall.content).toEqual([]);
    expect(tools[1].toolCall.content).toEqual([]);
  });
});

describe('codex mappers', () => {
  it('maps item statuses, folding declined into failed', () => {
    expect(mapCodexItemStatus('inProgress')).toBe('in_progress');
    expect(mapCodexItemStatus('completed')).toBe('completed');
    expect(mapCodexItemStatus('failed')).toBe('failed');
    expect(mapCodexItemStatus('declined')).toBe('failed');
    expect(mapCodexItemStatus(undefined)).toBe('in_progress');
  });
  it('maps token usage breakdown fields', () => {
    expect(
      mapCodexTokenUsage({
        totalTokens: 38,
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 3 });
  });
  it('maps permission outcomes to approval decisions', () => {
    expect(decisionFromOutcome({ outcome: 'selected', optionId: 'allow' })).toBe('accept');
    expect(decisionFromOutcome({ outcome: 'selected', optionId: 'allow_always' })).toBe(
      'acceptForSession',
    );
    expect(decisionFromOutcome({ outcome: 'selected', optionId: 'reject' })).toBe('decline');
    expect(decisionFromOutcome({ outcome: 'cancelled' })).toBe('cancel');
  });
});

describe('CodexAdapter approval-policy switching', () => {
  it('broadcasts the advertised tiers with the new current id on an accepted switch', async () => {
    const adapter = new CodexAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));

    // The switch itself needs no live server: it is stored and rides the next turn/start.
    await adapter.send({ type: 'set-approval-policy', policyId: 'bypassPermissions' });
    const update = events.find((e) => e.type === 'approval-policy-update');
    expect(update?.state.currentPolicyId).toBe('bypassPermissions');
    expect(update?.state.availablePolicies.map((p) => p.policyId)).toEqual([
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
  });

  it('rejects ids with no codex translation (claude-only tiers included)', async () => {
    const adapter = new CodexAdapter();
    await expect(adapter.send({ type: 'set-approval-policy', policyId: 'auto' })).rejects.toThrow(
      "codex: unknown approval policy 'auto'",
    );
  });
});

/** Captures app-server traffic. By default turns settle synchronously so each prompt runs a full
 * cycle; with `autoCompleteTurns` off, the test drives `turn/completed` and the `turn/start`
 * reply separately to exercise their orderings. */
class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  /** Manual mode: in-flight `turn/start` RPCs whose reply the test releases via `respond`. */
  readonly pendingTurnStarts: Array<{ id: string; respond: () => void }> = [];
  autoCompleteTurns = true;
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: params as Record<string, unknown> });
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve({ thread: { id: 'thread-1' } });
    }
    if (method === 'turn/start') {
      const id = `turn-${this.requests.length}`;
      if (this.autoCompleteTurns) {
        this.completeTurn(id);
        return Promise.resolve({ turn: { id } });
      }
      return new Promise((resolve) => {
        this.pendingTurnStarts.push({ id, respond: () => resolve({ turn: { id } }) });
      });
    }
    return Promise.resolve({});
  }
  completeTurn(id: string): void {
    this.opts.onNotification('turn/completed', { turn: { id, status: 'completed' } });
  }
  notify(method: string, params: Record<string, unknown>): void {
    this.opts.onNotification(method, params);
  }
  setRequestHandler(): void {
    // Approvals are not exercised here.
  }
  close(): void {
    // Nothing to reap.
  }
}

class TestCodex extends CodexAdapter {
  fakeServers: FakeCodexServer[] = [];
  autoCompleteTurns = true;
  configured: 'read-only' | 'workspace-write' | 'danger-full-access' | undefined;
  protected override startAppServer(
    opts: Omit<CodexAppServerOptions, 'binaryPath'>,
  ): Promise<CodexServerHandle> {
    const server = new FakeCodexServer(opts);
    server.autoCompleteTurns = this.autoCompleteTurns;
    this.fakeServers.push(server);
    return Promise.resolve(server);
  }
  protected override readConfiguredSandbox() {
    return Promise.resolve(this.configured);
  }
  turnStarts(): Array<Record<string, unknown>> {
    return this.fakeServers.flatMap((s) =>
      s.requests.flatMap((r) => (r.method === 'turn/start' ? [r.params] : [])),
    );
  }
}

describe('CodexAdapter sandbox deferral to config.toml', () => {
  const start: StartOptions = { kind: 'codex', cwd: '/repo' };
  const prompt: AgentInput = { type: 'prompt', content: [{ type: 'text', text: 'hi' }] };

  it('omits sandbox overrides while the user has a configured sandbox and no tier was picked', async () => {
    const adapter = new TestCodex();
    adapter.configured = 'read-only';
    await adapter.start(start);
    const threadStart = adapter.fakeServers[0].requests.find((r) => r.method === 'thread/start');
    expect(threadStart?.params).not.toHaveProperty('sandbox');
    expect(threadStart?.params.approvalPolicy).toBe('on-request');

    await adapter.send(prompt);
    expect(adapter.turnStarts()[0]).not.toHaveProperty('sandboxPolicy');

    // An explicit pick applies the preset exactly, config.toml notwithstanding.
    await adapter.send({ type: 'set-approval-policy', policyId: 'acceptEdits' });
    await adapter.send(prompt);
    expect(adapter.turnStarts()[1].sandboxPolicy).toMatchObject({ type: 'workspaceWrite' });
  });

  it('injects the preset sandbox when config.toml leaves it unset', async () => {
    const adapter = new TestCodex();
    adapter.configured = undefined;
    await adapter.start(start);
    const threadStart = adapter.fakeServers[0].requests.find((r) => r.method === 'thread/start');
    expect(threadStart?.params.sandbox).toBe('workspace-write');

    await adapter.send(prompt);
    expect(adapter.turnStarts()[0].sandboxPolicy).toMatchObject({ type: 'workspaceWrite' });
  });
});

describe('CodexAdapter image prompts', () => {
  it('sends text and images to app-server in the original block order', async () => {
    const adapter = new TestCodex();
    await adapter.start({ kind: 'codex', cwd: '/repo' });
    await adapter.send({
      type: 'prompt',
      content: [
        { type: 'text', text: 'before' },
        { type: 'image', data: 'cG5n', mimeType: 'image/png' },
        { type: 'text', text: 'after' },
      ],
    });

    expect(adapter.turnStarts()[0].input).toEqual([
      { type: 'text', text: 'before', text_elements: [] },
      { type: 'image', url: 'data:image/png;base64,cG5n' },
      { type: 'text', text: 'after', text_elements: [] },
    ]);
  });

  it('keeps the existing newline join for pure-text prompts', async () => {
    const adapter = new TestCodex();
    await adapter.start({ kind: 'codex', cwd: '/repo' });
    await adapter.send({
      type: 'prompt',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });

    expect(adapter.turnStarts()[0].input).toEqual([
      { type: 'text', text: 'hello\nworld', text_elements: [] },
    ]);
  });
});

describe('CodexAdapter tool content', () => {
  it('appends completed command output before emitting the terminal snapshot', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start({ kind: 'codex', cwd: '/repo' });
    const server = adapter.fakeServers[0];

    server.notify('item/started', {
      item: { type: 'commandExecution', id: 'cmd-1', command: 'echo hi', status: 'inProgress' },
    });
    server.notify('item/completed', {
      item: {
        type: 'commandExecution',
        id: 'cmd-1',
        command: 'echo hi',
        status: 'completed',
        aggregatedOutput: 'hi\n',
        exitCode: 0,
      },
    });

    expect(events.filter((event) => event.type.startsWith('tool-call'))).toEqual([
      expect.objectContaining({ type: 'tool-call' }),
      {
        type: 'tool-call-content-chunk',
        toolCallId: 'cmd-1',
        content: { type: 'content', content: { type: 'text', text: 'hi\n' } },
      },
      expect.objectContaining({
        type: 'tool-call',
        toolCall: expect.objectContaining({
          toolCallId: 'cmd-1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'hi\n' } }],
        }),
      }),
    ]);
  });
});

describe('CodexAdapter message snapshots', () => {
  it('preserves streamed text when a completed item omits its body', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));
    await adapter.start({ kind: 'codex', cwd: '/repo' });
    const server = adapter.fakeServers[0];

    server.notify('item/agentMessage/delta', { itemId: 'message-1', delta: 'streamed' });
    server.notify('item/completed', { item: { type: 'agentMessage', id: 'message-1' } });

    expect(
      events.filter(
        (event) => event.type === 'agent-message-chunk' || event.type === 'agent-message',
      ),
    ).toEqual([
      {
        type: 'agent-message-chunk',
        messageId: 'message-1',
        parentToolCallId: undefined,
        content: { type: 'text', text: 'streamed' },
      },
      {
        type: 'agent-message',
        messageId: 'message-1',
        parentToolCallId: undefined,
        content: undefined,
      },
    ]);
  });
});

describe('CodexAdapter turn queueing', () => {
  const start: StartOptions = { kind: 'codex', cwd: '/repo' };
  const prompt: AgentInput = { type: 'prompt', content: [{ type: 'text', text: 'hi' }] };
  const settle = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

  it("keeps queueing while a drained prompt's turn/start is still in flight", async () => {
    const adapter = new TestCodex();
    adapter.autoCompleteTurns = false;
    await adapter.start(start);
    const server = adapter.fakeServers[0];

    // Turn A starts; its RPC reply is withheld. A second prompt queues behind it.
    const firstSend = adapter.send(prompt);
    await settle();
    await adapter.send(prompt);
    expect(adapter.turnStarts()).toHaveLength(1);

    // codex can settle a whole turn before replying to its turn/start: completing A drains the
    // queued prompt into turn B while A's request is still awaiting its reply.
    server.completeTurn(server.pendingTurnStarts[0].id);
    await settle();
    expect(adapter.turnStarts()).toHaveLength(2);

    // A's late reply lands; its cleanup must not drop B's guard — a third prompt still queues.
    server.pendingTurnStarts[0].respond();
    await firstSend;
    await adapter.send(prompt);
    expect(adapter.turnStarts()).toHaveLength(2);

    // B settles and replies: the queued third prompt drains as turn C.
    server.completeTurn(server.pendingTurnStarts[1].id);
    server.pendingTurnStarts[1].respond();
    await settle();
    expect(adapter.turnStarts()).toHaveLength(3);
  });
});

describe('diffContentFromUnified', () => {
  it('keeps the patch authoritative with old/new text as fallback', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      ' const c = 4;',
    ].join('\n');
    expect(diffContentFromUnified('src/a.ts', diff)).toEqual([
      {
        type: 'diff',
        change: 'modify',
        path: 'src/a.ts',
        oldText: 'const a = 1;\nconst b = 2;\nconst c = 4;',
        newText: 'const a = 1;\nconst b = 3;\nconst c = 4;',
        patch: { format: 'git_patch', text: diff },
      },
    ]);
  });
  it('combines hunk fallbacks without duplicating the patch', () => {
    const diff = ['@@ -1 +1 @@', '-a', '+b', '@@ -10 +10 @@', '-x', '+y'].join('\n');
    expect(diffContentFromUnified('f', diff)).toEqual([
      {
        type: 'diff',
        change: 'modify',
        path: 'f',
        oldText: 'a\nx',
        newText: 'b\ny',
        patch: { format: 'git_patch', text: diff },
      },
    ]);
  });
  it('retains move identity and removes codex move metadata from the patch', () => {
    const diff = '@@ -1 +1 @@\n-old\n+new\n\nMoved to: new.ts';
    expect(diffContentFromUnified('new.ts', diff, { change: 'move', oldPath: 'old.ts' })).toEqual([
      {
        type: 'diff',
        change: 'move',
        path: 'new.ts',
        oldPath: 'old.ts',
        oldText: 'old',
        newText: 'new',
        patch: { format: 'git_patch', text: '@@ -1 +1 @@\n-old\n+new' },
      },
    ]);
  });
  it('renders a pure insertion fallback without oldText', () => {
    const diff = ['@@ -0,0 +1,2 @@', '+line 1', '+line 2', ''].join('\n');
    expect(diffContentFromUnified('new.ts', diff)).toEqual([
      {
        type: 'diff',
        change: 'modify',
        path: 'new.ts',
        oldText: undefined,
        newText: 'line 1\nline 2',
        patch: { format: 'git_patch', text: diff },
      },
    ]);
  });
  it('keeps non-hunk provider text as a patch-only record', () => {
    expect(diffContentFromUnified('raw.txt', 'plain content')).toEqual([
      {
        type: 'diff',
        change: 'modify',
        path: 'raw.txt',
        oldText: undefined,
        newText: undefined,
        patch: { format: 'git_patch', text: 'plain content' },
      },
    ]);
  });
});

describe('stop reason mappers', () => {
  it('claude', () => {
    expect(mapClaudeStop('max_tokens')).toBe('max_tokens');
    expect(mapClaudeStop('tool_use')).toBe('end_turn');
    expect(mapClaudeStop(null)).toBe('end_turn');
  });
});
