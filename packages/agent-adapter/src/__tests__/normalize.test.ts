import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
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
  extra?: { timestamp?: string; model?: string },
): SessionMessage {
  return {
    type,
    uuid,
    session_id: 'h1',
    parent_tool_use_id: parentToolUseId,
    parent_agent_id: null,
    message: { content, ...(extra?.model && { model: extra.model }) },
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
    expect(announce.map((e) => e.event.type)).toEqual(['agent-message-chunk', 'tool-call']);
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
        { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' },
      ]);
    }

    const settle = map(
      row('user', 'u2', [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'updated' }]),
    );
    if (settle[0].event.type === 'tool-call') {
      expect(settle[0].event.toolCall.content).toEqual([
        { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' },
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
      `agent-message-chunk@${Date.parse(at)}`,
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
    expect(second.map((e) => e.event.type)).toEqual(['agent-message-chunk']);

    // A switch re-announces; a subagent row's model never does.
    const switched = map(
      row('assistant', 'u3', [{ type: 'text', text: 'switched' }], null, {
        model: 'claude-sonnet-5',
      }),
    );
    expect(switched.map((e) => e.event.type)).toEqual(['model-update', 'agent-message-chunk']);
    const subagent = map(
      row('assistant', 'u4', [{ type: 'text', text: 'sub' }], 'toolu_task', {
        model: 'claude-haiku-4-5',
      }),
    );
    expect(subagent.map((e) => e.event.type)).toEqual(['agent-message-chunk']);
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
    expect(reply.map((e) => e.event.type)).toEqual(['agent-message-chunk']);
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
      type: 'agent-message-chunk',
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

    const diff = { type: 'diff', path: 'src/a.ts', oldText: 'a', newText: 'b' };
    const tools = toolSnapshots(seen);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolCall.content).toEqual([diff]);
    expect(tools[1].toolCall.status).toBe('completed');
    expect(tools[1].toolCall.content).toEqual([
      diff,
      { type: 'content', content: { type: 'text', text: 'updated' } },
    ]);
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
      { type: 'diff', path: 'src/new.ts', newText: 'export const a = 1;\n' },
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
  it('splits hunks into old/new sides with context', () => {
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
        path: 'src/a.ts',
        oldText: 'const a = 1;\nconst b = 2;\nconst c = 4;',
        newText: 'const a = 1;\nconst b = 3;\nconst c = 4;',
      },
    ]);
  });
  it('emits one block per hunk', () => {
    const diff = ['@@ -1 +1 @@', '-a', '+b', '@@ -10 +10 @@', '-x', '+y'].join('\n');
    expect(diffContentFromUnified('f', diff)).toEqual([
      { type: 'diff', path: 'f', oldText: 'a', newText: 'b' },
      { type: 'diff', path: 'f', oldText: 'x', newText: 'y' },
    ]);
  });
  it('renders a pure insertion without oldText, like a Write', () => {
    const diff = ['@@ -0,0 +1,2 @@', '+line 1', '+line 2', ''].join('\n');
    expect(diffContentFromUnified('new.ts', diff)).toEqual([
      { type: 'diff', path: 'new.ts', oldText: undefined, newText: 'line 1\nline 2' },
    ]);
  });
  it('falls back to all-added content when no hunk header is present', () => {
    expect(diffContentFromUnified('raw.txt', 'plain content')).toEqual([
      { type: 'diff', path: 'raw.txt', newText: 'plain content' },
    ]);
  });
});

describe('CodexAdapter history', () => {
  it('lists and reads local Codex JSONL transcripts', async () => {
    const previousCodexHome = env.CODEX_HOME;
    const codexHome = await mkdtemp(join(tmpdir(), 'linkcode-codex-history-'));
    try {
      env.CODEX_HOME = codexHome;
      const sessionDir = join(codexHome, 'sessions', '2026', '06', '17');
      await mkdir(sessionDir, { recursive: true });
      await writeFile(
        join(codexHome, 'session_index.jsonl'),
        `${JSON.stringify({
          id: 'thread-1',
          thread_name: 'Fixture thread',
          updated_at: '2026-06-17T01:03:00.000Z',
        })}\n`,
      );
      await writeFile(
        join(sessionDir, 'rollout-thread-1.jsonl'),
        [
          {
            timestamp: '2026-06-17T01:00:00.000Z',
            type: 'session_meta',
            payload: {
              id: 'thread-1',
              cwd: '/repo',
              model: 'gpt-test',
              cli_version: '1.2.3',
              git: { branch: 'main' },
            },
          },
          {
            // Machine-injected context codex persists as a user-role message; must not replay
            // as a user bubble or count as a conversation message.
            timestamp: '2026-06-17T01:00:30.000Z',
            type: 'response_item',
            payload: {
              id: 'synthetic-1',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>',
                },
              ],
            },
          },
          {
            timestamp: '2026-06-17T01:01:00.000Z',
            type: 'response_item',
            payload: {
              id: 'user-1',
              role: 'user',
              content: [{ type: 'input_text', text: 'hello' }],
            },
          },
          {
            timestamp: '2026-06-17T01:02:00.000Z',
            type: 'response_item',
            payload: {
              id: 'assistant-1',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'world' }],
            },
          },
        ]
          .map((row) => JSON.stringify(row))
          .join('\n'),
      );

      const adapter = new CodexAdapter();
      const listed = await adapter.listHistory({ cwd: '/repo', limit: 1 });
      const session = listed.sessions[0];
      expect(session).toMatchObject({
        historyId: 'thread-1',
        kind: 'codex',
        title: 'Fixture thread',
        cwd: '/repo',
        model: 'gpt-test',
        messageCount: 2,
      });

      const read = await adapter.readHistory({ historyId: session.historyId, limit: 10 });
      expect(read.events.map((event) => event.event.type)).toEqual([
        'user-message',
        'agent-message-chunk',
      ]);
      expect(read.events[0]?.event).toMatchObject({
        type: 'user-message',
        messageId: 'user-1',
        content: [{ type: 'text', text: 'hello' }],
      });
      expect(read.events[1]?.event).toMatchObject({
        type: 'agent-message-chunk',
        messageId: 'assistant-1',
        content: { type: 'text', text: 'world' },
      });
    } finally {
      if (previousCodexHome === undefined) env.CODEX_HOME = undefined;
      else env.CODEX_HOME = previousCodexHome;
      await rm(codexHome, { recursive: true, force: true });
    }
  });
});

describe('stop reason mappers', () => {
  it('claude', () => {
    expect(mapClaudeStop('max_tokens')).toBe('max_tokens');
    expect(mapClaudeStop('tool_use')).toBe('end_turn');
    expect(mapClaudeStop(null)).toBe('end_turn');
  });
});
