import type { AgentEvent, MessageId } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import {
  buildConversation,
  contentPreview,
  createConversationBuilder,
  toolCallDiffs,
} from '../conversation';

function text(t: string, messageId = 'm1'): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: { type: 'text', text: t },
  };
}
function userText(t: string): AgentEvent {
  return {
    type: 'user-message',
    content: [{ type: 'text', text: t }],
  };
}

describe('buildConversation', () => {
  it('returns an empty conversation for no events', () => {
    const c = buildConversation([]);
    expect(c.items).toEqual([]);
    expect(c.status).toBeNull();
    expect(c.usage).toBeNull();
    expect(c.availableCommands).toBeNull();
    expect(c.pendingPermissionIds).toEqual([]);
  });

  it('replaces the command catalog wholesale on each available-commands-update', () => {
    const c = buildConversation([
      { type: 'available-commands-update', commands: [{ name: 'stale' }] },
      {
        type: 'available-commands-update',
        commands: [{ name: 'compact', description: 'Compact the context' }],
      },
    ]);
    expect(c.availableCommands).toEqual([{ name: 'compact', description: 'Compact the context' }]);
    // Catalog updates never add timeline items.
    expect(c.items).toEqual([]);
  });

  it('coalesces same-messageId agent chunks into one streaming block', () => {
    const c = buildConversation([
      { type: 'status', status: 'running' },
      text('Hel'),
      text('lo, '),
      text('world'),
    ]);
    expect(c.items).toHaveLength(1);
    const item = c.items[0];
    expect(item.kind).toBe('message');
    if (item.kind === 'message') {
      expect(item.role).toBe('assistant');
      expect(item.turnId).toBeNull();
      expect(item.isStreaming).toBe(true);
      expect(item.blocks).toHaveLength(1);
      expect(item.blocks[0]).toEqual({ type: 'text', text: 'Hello, world' });
    }
  });

  it('separates user and assistant messages while keeping a turn id across activity', () => {
    const c = buildConversation([
      userText('do it'),
      text('working', 'a1'),
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Read file',
          kind: 'read',
          status: 'in_progress',
          content: [],
        },
      },
      // A new messageId opens a fresh assistant bubble after the tool call.
      text('done', 'a2'),
    ]);
    expect(c.items.map((i) => i.kind)).toEqual(['message', 'message', 'tool', 'message']);
    const [user, assistant, tool, followup] = c.items;
    if (
      user.kind === 'message' &&
      assistant.kind === 'message' &&
      tool.kind === 'tool' &&
      followup.kind === 'message'
    ) {
      expect(user.role).toBe('user');
      expect(assistant.role).toBe('assistant');
      expect(followup.role).toBe('assistant');
      expect(user.turnId).toBeTruthy();
      expect(assistant.turnId).toBe(user.turnId);
      expect(tool.turnId).toBe(user.turnId);
      expect(followup.turnId).toBe(user.turnId);
    }
  });

  it('projects thought chunks as reasoning and marks active reasoning as streaming', () => {
    const c = buildConversation([
      userText('think'),
      { type: 'status', status: 'running' },
      {
        type: 'agent-thought-chunk',
        messageId: 'th1' as MessageId,
        content: { type: 'text', text: 'step 1' },
      },
      {
        type: 'agent-thought-chunk',
        messageId: 'th1' as MessageId,
        content: { type: 'text', text: ' step 2' },
      },
    ]);
    const reasoning = c.items.at(-1);
    const first = c.items[0];
    expect(reasoning?.kind).toBe('reasoning');
    if (reasoning?.kind === 'reasoning' && first.kind === 'message') {
      expect(reasoning.blocks).toEqual([{ type: 'text', text: 'step 1 step 2' }]);
      expect(reasoning.isStreaming).toBe(true);
      expect(reasoning.turnId).toBe(first.turnId);
    }
  });

  it('replaces a tool call by id with each full snapshot', () => {
    const c = buildConversation([
      {
        type: 'tool-call',
        toolCall: { toolCallId: 't1', title: 'Edit', kind: 'edit', status: 'pending', content: [] },
      },
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Edit',
          kind: 'edit',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Edit',
          kind: 'edit',
          status: 'completed',
          content: [{ type: 'diff', path: '/a.ts', oldText: 'a', newText: 'b' }],
        },
      },
    ]);
    expect(c.items).toHaveLength(1);
    const item = c.items[0];
    expect(item.kind).toBe('tool');
    if (item.kind === 'tool') {
      expect(item.toolCall.status).toBe('completed');
      expect(item.toolCall.title).toBe('Edit');
      expect(toolCallDiffs(item.toolCall)).toHaveLength(1);
    }
  });

  it('carries parentToolCallId on subagent chunks and tool snapshots', () => {
    const c = buildConversation([
      {
        type: 'agent-message-chunk',
        messageId: 'sub-m1' as MessageId,
        parentToolCallId: 'toolu_task',
        content: { type: 'text', text: 'nested narration' },
      },
      {
        type: 'agent-thought-chunk',
        messageId: 'sub-t1' as MessageId,
        parentToolCallId: 'toolu_task',
        content: { type: 'text', text: 'nested thought' },
      },
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 'toolu_sub',
          parentToolCallId: 'toolu_task',
          title: 'Read',
          kind: 'read',
          status: 'completed',
          content: [],
        },
      },
    ]);
    expect(c.items).toHaveLength(3);
    const [message, reasoning, tool] = c.items;
    if (message.kind === 'message') expect(message.parentToolCallId).toBe('toolu_task');
    if (reasoning.kind === 'reasoning') expect(reasoning.parentToolCallId).toBe('toolu_task');
    if (tool.kind === 'tool') expect(tool.toolCall.parentToolCallId).toBe('toolu_task');
  });

  it('keeps only the latest plan per turn', () => {
    const c = buildConversation([
      userText('first'),
      { type: 'plan', plan: { entries: [{ content: 'a', priority: 'high', status: 'pending' }] } },
      {
        type: 'plan',
        plan: {
          entries: [
            { content: 'a', priority: 'high', status: 'completed' },
            { content: 'b', priority: 'low', status: 'pending' },
          ],
        },
      },
      userText('second'),
      {
        type: 'plan',
        plan: { entries: [{ content: 'c', priority: 'medium', status: 'pending' }] },
      },
    ]);
    const plans = c.items.filter((i) => i.kind === 'plan');
    expect(plans).toHaveLength(2);
    const firstPlan = nullthrow(plans[0]);
    const secondPlan = nullthrow(plans[1]);
    expect(firstPlan.plan.entries).toHaveLength(2);
    expect(firstPlan.plan.entries[0]?.status).toBe('completed');
    expect(secondPlan.plan.entries).toHaveLength(1);
    expect(firstPlan.turnId).not.toBe(secondPlan.turnId);
  });

  it('tracks a permission as pending until its tool call settles', () => {
    const base: AgentEvent[] = [
      userText('run'),
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Run',
          kind: 'execute',
          status: 'pending',
          content: [],
        },
      },
      {
        type: 'permission-request',
        requestId: 'p1',
        toolCall: { toolCallId: 't1', title: 'Run' },
        options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
      },
    ];
    expect(buildConversation(base).pendingPermissionIds).toEqual(['p1']);
    expect(buildConversation(base).items.some((i) => i.kind === 'approval')).toBe(true);

    const settled = buildConversation([
      ...base,
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'Run',
          kind: 'execute',
          status: 'completed',
          content: [],
        },
      },
    ]);
    expect(settled.pendingPermissionIds).toEqual([]);
  });

  it('tracks a question as pending until its tool call settles', () => {
    const question = {
      questionId: 'q0',
      prompt: 'Which one?',
      multiSelect: false,
      options: [
        { optionId: 'o0', label: 'A' },
        { optionId: 'o1', label: 'B' },
      ],
    };
    const base: AgentEvent[] = [
      userText('ask'),
      {
        type: 'question-request',
        requestId: 'ask1',
        toolCall: { toolCallId: 't1', title: 'AskUserQuestion' },
        questions: [question],
      },
    ];
    const open = buildConversation(base);
    expect(open.pendingQuestionIds).toEqual(['ask1']);
    const item = open.items.find((i) => i.kind === 'question');
    expect(item).toMatchObject({ requestId: 'ask1', questions: [question] });

    const settled = buildConversation([
      ...base,
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 't1',
          title: 'AskUserQuestion',
          kind: 'other',
          status: 'completed',
          content: [],
        },
      },
    ]);
    expect(settled.pendingQuestionIds).toEqual([]);
  });

  it('folds an attach-replayed duplicate ask only once, by requestId', () => {
    const ask: AgentEvent = {
      type: 'question-request',
      requestId: 'ask1',
      toolCall: { toolCallId: 't1', title: 'AskUserQuestion' },
      questions: [
        {
          questionId: 'q0',
          prompt: 'Which one?',
          multiSelect: false,
          options: [
            { optionId: 'o0', label: 'A' },
            { optionId: 'o1', label: 'B' },
          ],
        },
      ],
    };
    const perm: AgentEvent = {
      type: 'permission-request',
      requestId: 'p1',
      toolCall: { toolCallId: 't2', title: 'Run' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
    };
    const c = buildConversation([userText('go'), ask, perm, ask, perm]);
    expect(c.items.filter((i) => i.kind === 'question')).toHaveLength(1);
    expect(c.items.filter((i) => i.kind === 'approval')).toHaveLength(1);
    expect(c.pendingQuestionIds).toEqual(['ask1']);
    expect(c.pendingPermissionIds).toEqual(['p1']);
  });

  it('captures lifecycle state (status / usage / mode / stop / error)', () => {
    const c = buildConversation([
      { type: 'status', status: 'running' },
      { type: 'current-mode-update', currentModeId: 'plan' },
      { type: 'token-usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'error', message: 'boom', recoverable: true },
      { type: 'stop', stopReason: 'end_turn' },
    ]);
    expect(c.status).toBe('running');
    expect(c.currentModeId).toBe('plan');
    expect(c.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(c.stopReason).toBe('end_turn');
    expect(c.items.filter((i) => i.kind === 'error')).toHaveLength(1);
    const error = c.items.find((i) => i.kind === 'error');
    expect(error?.turnId).toBeNull();
  });

  it('reflects the latest approval-policy state without adding timeline items', () => {
    const policies = [
      { policyId: 'default', name: 'Ask for approval' },
      { policyId: 'auto', name: 'Auto' },
    ];
    expect(buildConversation([]).approvalPolicy).toBeNull();
    const c = buildConversation([
      {
        type: 'approval-policy-update',
        state: { availablePolicies: policies, currentPolicyId: 'default' },
      },
      {
        type: 'approval-policy-update',
        state: { availablePolicies: policies, currentPolicyId: 'auto' },
      },
    ]);
    expect(c.approvalPolicy).toEqual({ availablePolicies: policies, currentPolicyId: 'auto' });
    expect(c.items).toHaveLength(0);
  });

  it('reflects the latest model/effort without adding timeline items', () => {
    const empty = buildConversation([]);
    expect(empty.currentModel).toBeNull();
    expect(empty.currentEffort).toBeNull();
    const c = buildConversation([
      { type: 'model-update', model: 'claude-opus-4-8' },
      { type: 'effort-update', effort: 'high' },
      { type: 'model-update', model: 'claude-sonnet-5' },
      { type: 'effort-update', effort: 'xhigh' },
    ]);
    expect(c.currentModel).toBe('claude-sonnet-5');
    expect(c.currentEffort).toBe('xhigh');
    expect(c.items).toHaveLength(0);
  });

  it('places a compaction marker in the timeline and merges re-emits by compactionId', () => {
    const c = buildConversation([
      userText('do it'),
      text('working', 'a1'),
      // The adapter announces the boundary first (metadata only)…
      { type: 'compaction', compactionId: 'cb1', trigger: 'auto', preTokens: 1000, postTokens: 20 },
      // …then re-emits the same id once the summary text arrives.
      { type: 'compaction', compactionId: 'cb1', summary: 'what happened so far' },
      text('continuing', 'a2'),
    ]);
    expect(c.items.map((item) => item.kind)).toEqual([
      'message',
      'message',
      'compaction',
      'message',
    ]);
    const marker = c.items[2];
    expect(marker).toMatchObject({
      kind: 'compaction',
      id: 'cb1',
      trigger: 'auto',
      preTokens: 1000,
      postTokens: 20,
      summary: 'what happened so far',
    });
  });

  it('keeps distinct compactions as separate markers', () => {
    const c = buildConversation([
      { type: 'compaction', compactionId: 'cb1', trigger: 'auto' },
      { type: 'compaction', compactionId: 'cb2', trigger: 'manual' },
    ]);
    expect(c.items).toHaveLength(2);
  });
});

describe('createConversationBuilder', () => {
  const scenario: AgentEvent[] = [
    userText('do it'),
    { type: 'status', status: 'running' },
    text('working', 'a1'),
    {
      type: 'tool-call',
      toolCall: { toolCallId: 't1', title: 'Run', kind: 'execute', status: 'pending', content: [] },
    },
    {
      type: 'permission-request',
      requestId: 'p1',
      toolCall: { toolCallId: 't1', title: 'Run' },
      options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
    },
    {
      type: 'tool-call',
      toolCall: {
        toolCallId: 't1',
        title: 'Run',
        kind: 'execute',
        status: 'completed',
        content: [],
      },
    },
    { type: 'plan', plan: { entries: [{ content: 'a', priority: 'high', status: 'pending' }] } },
    text(' done', 'a1'),
    { type: 'token-usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'stop', stopReason: 'end_turn' },
  ];

  it('advancing event-by-event equals a single fold', () => {
    const builder = createConversationBuilder();
    for (const event of scenario) builder.advance(event);
    expect(builder.snapshot()).toEqual(buildConversation(scenario));
  });

  it('returns the same snapshot object until the next advance', () => {
    const builder = createConversationBuilder();
    builder.advance(userText('hi'));
    const first = builder.snapshot();
    expect(builder.snapshot()).toBe(first);
    builder.advance(text('yo'));
    expect(builder.snapshot()).not.toBe(first);
  });

  it('never mutates previously returned snapshots (copy-on-write)', () => {
    const builder = createConversationBuilder();
    for (const event of scenario.slice(0, 5)) builder.advance(event);
    const before = builder.snapshot();
    const frozen = structuredClone(before);

    for (const event of scenario.slice(5)) builder.advance(event);
    builder.snapshot();
    // The earlier snapshot still shows the pending tool call and the streaming message.
    expect(before).toEqual(frozen);
  });
});

describe('contentPreview', () => {
  it('joins text and tags non-text blocks', () => {
    expect(
      contentPreview([
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
      ]),
    ).toBe('hello [image]');
  });
});
