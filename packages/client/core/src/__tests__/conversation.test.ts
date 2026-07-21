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
function thought(t: string, messageId: string, parentToolCallId?: string): AgentEvent {
  return {
    type: 'agent-thought-chunk',
    messageId: messageId as MessageId,
    parentToolCallId,
    content: { type: 'text', text: t },
  };
}

describe('buildConversation', () => {
  it('returns an empty conversation for no events', () => {
    const c = buildConversation([]);
    expect(c.items).toEqual([]);
    expect(c.status).toBeNull();
    expect(c.usage).toBeNull();
    expect(c.availableCommands).toBeNull();
    expect(c.capabilities).toBeNull();
    expect(c.pendingPermissionIds).toEqual([]);
  });

  it('reflects the latest adapter capabilities without adding timeline items', () => {
    const c = buildConversation([
      {
        type: 'capabilities-update',
        capabilities: { slashCommands: false, shellCommand: false },
      },
      {
        type: 'capabilities-update',
        capabilities: { slashCommands: true, shellCommand: true },
      },
    ]);
    expect(c.capabilities).toEqual({ slashCommands: true, shellCommand: true });
    expect(c.items).toEqual([]);
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

  it('replaces the model catalog wholesale on each available-models-update', () => {
    const c = buildConversation([
      { type: 'available-models-update', models: [{ id: 'stale/old', label: 'Old' }] },
      {
        type: 'available-models-update',
        models: [{ id: 'openai/gpt-5-nano', label: 'GPT-5 Nano', description: 'OpenAI' }],
      },
    ]);
    expect(c.availableModels).toEqual([
      { id: 'openai/gpt-5-nano', label: 'GPT-5 Nano', description: 'OpenAI' },
    ]);
    // Catalog updates never add timeline items.
    expect(c.items).toEqual([]);
  });

  it('stamps assistant messages with the model serving them, backfilling late reports', () => {
    const c = buildConversation([
      { type: 'model-update', model: 'claude-opus-4-8' },
      userText('first'),
      text('reply one', 'm1'),
      { type: 'model-update', model: 'claude-sonnet-5' },
      userText('second'),
      text('reply two', 'm2'),
    ]);
    const models = c.items.flatMap((item) =>
      item.kind === 'message' && item.role === 'assistant' ? [item.model] : [],
    );
    expect(models).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);

    // A model reported only mid-stream still lands on the already-open message.
    const late = buildConversation([
      text('opens dateless', 'm3'),
      { type: 'model-update', model: 'claude-opus-4-8' },
      text(' — continued', 'm3'),
    ]);
    const item = late.items[0];
    expect(item.kind === 'message' && item.model).toBe('claude-opus-4-8');
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

  it('tracks a permission until its authoritative resolution', () => {
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

    const toolSettled = buildConversation([
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
    expect(toolSettled.pendingPermissionIds).toEqual(['p1']);

    const settled = buildConversation([
      ...base,
      {
        type: 'permission-resolved',
        requestId: 'p1',
        outcome: { outcome: 'selected', optionId: 'ok' },
        source: 'user',
      },
    ]);
    expect(settled.pendingPermissionIds).toEqual([]);
    expect(settled.items.find((item) => item.kind === 'approval')).toMatchObject({
      resolution: {
        outcome: { outcome: 'selected', optionId: 'ok' },
        source: 'user',
      },
    });
  });

  it('tracks a question until its authoritative resolution', () => {
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

    const toolSettled = buildConversation([
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
    expect(toolSettled.pendingQuestionIds).toEqual(['ask1']);

    const outcome = {
      outcome: 'answered' as const,
      answers: [{ questionId: 'q0', selectedOptionIds: ['o0'] }],
    };
    const settled = buildConversation([
      ...base,
      { type: 'question-resolved', requestId: 'ask1', outcome, source: 'user' },
    ]);
    expect(settled.pendingQuestionIds).toEqual([]);
    expect(settled.items.find((i) => i.kind === 'question')).toMatchObject({
      resolution: { outcome, source: 'user' },
    });
  });

  it('folds cross-client response status and clears it on resolution', () => {
    const ask: AgentEvent = {
      type: 'question-request',
      requestId: 'ask1',
      toolCall: { toolCallId: 't1', title: 'AskUserQuestion' },
      questions: [
        {
          questionId: 'q0',
          prompt: 'Which one?',
          multiSelect: false,
          options: [{ optionId: 'o0', label: 'A' }],
        },
      ],
    };
    const responding: AgentEvent = {
      type: 'prompt-response-status',
      requestId: 'ask1',
      status: 'responding',
    };
    const active = buildConversation([ask, responding]);
    expect(active.items.find((item) => item.kind === 'question')).toMatchObject({
      responding: true,
    });

    const restored = buildConversation([
      ask,
      responding,
      { type: 'prompt-response-status', requestId: 'ask1', status: 'open' },
    ]);
    expect(restored.items.find((item) => item.kind === 'question')).toMatchObject({
      responding: false,
    });

    const resolved = buildConversation([
      ask,
      responding,
      {
        type: 'question-resolved',
        requestId: 'ask1',
        outcome: { outcome: 'cancelled' },
        source: 'session',
      },
      { type: 'prompt-response-status', requestId: 'ask1', status: 'open' },
    ]);
    expect(resolved.items.find((item) => item.kind === 'question')).toMatchObject({
      responding: false,
      resolution: { outcome: { outcome: 'cancelled' }, source: 'session' },
    });
  });

  it('dedupes attach-replayed request and resolution pairs by requestId', () => {
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
    const questionResolved: AgentEvent = {
      type: 'question-resolved',
      requestId: 'ask1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    };
    const permissionResolved: AgentEvent = {
      type: 'permission-resolved',
      requestId: 'p1',
      outcome: { outcome: 'selected', optionId: 'ok' },
      source: 'user',
    };
    const c = buildConversation([
      userText('go'),
      ask,
      perm,
      questionResolved,
      permissionResolved,
      ask,
      questionResolved,
      perm,
      permissionResolved,
    ]);
    expect(c.items.filter((i) => i.kind === 'question')).toHaveLength(1);
    expect(c.items.filter((i) => i.kind === 'approval')).toHaveLength(1);
    expect(c.pendingQuestionIds).toEqual([]);
    expect(c.pendingPermissionIds).toEqual([]);
  });

  it('joins a resolution that arrives before its replayed request', () => {
    const c = buildConversation([
      {
        type: 'permission-resolved',
        requestId: 'p1',
        outcome: { outcome: 'cancelled' },
        source: 'session',
      },
      {
        type: 'permission-request',
        requestId: 'p1',
        toolCall: { toolCallId: 't1', title: 'Run' },
        options: [{ optionId: 'ok', name: 'Allow', kind: 'allow_once' }],
      },
    ]);
    expect(c.pendingPermissionIds).toEqual([]);
    expect(c.items.find((item) => item.kind === 'approval')).toMatchObject({
      resolution: { outcome: { outcome: 'cancelled' }, source: 'session' },
    });
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

  it('exposes the latest usage-report wholesale without adding timeline items', () => {
    expect(buildConversation([]).usageReport).toBeNull();
    const first = {
      subscriptionType: 'max',
      rateLimits: {
        windows: [
          { id: 'five_hour', utilization: 6, resetsAt: '2026-07-16T07:49:00Z', durationMins: 300 },
        ],
      },
    };
    const second = {
      subscriptionType: 'max',
      rateLimits: {
        windows: [
          { id: 'five_hour', utilization: 42, resetsAt: '2026-07-16T12:49:00Z', durationMins: 300 },
        ],
      },
    };
    const c = buildConversation([
      { type: 'usage-report', report: first },
      { type: 'usage-report', report: second },
    ]);
    expect(c.usageReport).toEqual(second);
    expect(c.items).toHaveLength(0);
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

  it('tracks a live compaction from in_progress to completed on the same marker', () => {
    const started = buildConversation([
      { type: 'compaction', compactionId: 'cc1', status: 'in_progress' },
    ]);
    expect(started.items[0]).toMatchObject({ kind: 'compaction', status: 'in_progress' });

    const settled = buildConversation([
      { type: 'compaction', compactionId: 'cc1', status: 'in_progress' },
      { type: 'compaction', compactionId: 'cc1', status: 'completed' },
    ]);
    expect(settled.items).toHaveLength(1);
    expect(settled.items[0]).toMatchObject({ kind: 'compaction', status: 'completed' });
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

  it('records the first thought chunk as the start and keeps later chunks as updates', () => {
    const builder = createConversationBuilder();
    builder.advance(thought('first', 'th1'), 100);
    builder.advance(thought(' second', 'th1'), 160);

    const item = nullthrow(builder.snapshot().items[0]);
    expect(item.kind).toBe('reasoning');
    if (item.kind === 'reasoning') {
      expect(item.startedAt).toBe(100);
      expect(item.endedAt).toBeUndefined();
      expect(item.summary).toBeUndefined();
      expect(item.receivedAt).toBe(160);
    }
  });

  it('ends reasoning at the next new semantic item in the same scope only', () => {
    const builder = createConversationBuilder();
    builder.advance(thought('before tool', 'th1', 'task-1'), 100);
    builder.advance(
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 'read-1',
          parentToolCallId: 'task-1',
          title: 'Read',
          kind: 'read',
          status: 'in_progress',
          content: [],
        },
      },
      120,
    );
    builder.advance(thought('after tool', 'th2', 'task-1'), 140);
    builder.advance(
      {
        type: 'tool-call',
        toolCall: {
          toolCallId: 'read-1',
          parentToolCallId: 'task-1',
          title: 'Read',
          kind: 'read',
          status: 'completed',
          content: [],
        },
      },
      160,
    );

    const before = nullthrow(builder.snapshot().items.find((item) => item.id === 'th1'));
    const afterUpdate = nullthrow(builder.snapshot().items.find((item) => item.id === 'th2'));
    expect(before).toMatchObject({ kind: 'reasoning', startedAt: 100, endedAt: 120 });
    expect(afterUpdate).toMatchObject({ kind: 'reasoning', startedAt: 140 });
    if (afterUpdate.kind === 'reasoning') expect(afterUpdate.endedAt).toBeUndefined();

    builder.advance(
      {
        type: 'agent-message-chunk',
        messageId: 'message-1' as MessageId,
        parentToolCallId: 'task-1',
        content: { type: 'text', text: 'done' },
      },
      180,
    );
    expect(builder.snapshot().items.find((item) => item.id === 'th2')).toMatchObject({
      kind: 'reasoning',
      endedAt: 180,
    });
  });

  it('tracks active reasoning independently for parallel parent scopes', () => {
    const builder = createConversationBuilder();
    builder.advance({ type: 'status', status: 'running' }, 90);
    builder.advance(thought('one', 'th1', 'task-1'), 100);
    builder.advance(thought('two', 'th2', 'task-2'), 110);

    const active = builder.snapshot().items.filter((item) => item.kind === 'reasoning');
    expect(active.every((item) => item.isStreaming)).toBe(true);

    builder.advance(
      {
        type: 'agent-message-chunk',
        messageId: 'message-1' as MessageId,
        parentToolCallId: 'task-1',
        content: { type: 'text', text: 'first done' },
      },
      130,
    );

    const first = nullthrow(builder.snapshot().items.find((item) => item.id === 'th1'));
    const second = nullthrow(builder.snapshot().items.find((item) => item.id === 'th2'));
    expect(first).toMatchObject({ kind: 'reasoning', startedAt: 100, endedAt: 130 });
    expect(second).toMatchObject({ kind: 'reasoning', startedAt: 110, isStreaming: true });
    if (first.kind === 'reasoning') expect(first.isStreaming).toBe(false);
    if (second.kind === 'reasoning') expect(second.endedAt).toBeUndefined();
  });

  it.each([
    ['stop event', { type: 'stop', stopReason: 'end_turn' } as const],
    ['idle status', { type: 'status', status: 'idle' } as const],
    ['stopped status', { type: 'status', status: 'stopped' } as const],
  ])('ends reasoning in every scope on %s', (_label, settlement) => {
    const builder = createConversationBuilder();
    builder.advance({ type: 'status', status: 'running' }, 90);
    builder.advance(thought('main', 'th-main'), 100);
    builder.advance(thought('child', 'th-child', 'task-1'), 110);
    builder.advance(settlement, 150);

    const snapshot = builder.snapshot();
    const reasoning = snapshot.items.filter((item) => item.kind === 'reasoning');
    expect(reasoning).toHaveLength(2);
    expect(reasoning.every((item) => item.endedAt === 150)).toBe(true);
    expect(reasoning.every((item) => !item.isStreaming)).toBe(true);
  });

  it('keeps unknown timing absent and does not backfill the start from a later chunk', () => {
    const builder = createConversationBuilder();
    builder.advance(thought('unknown start', 'th1'));
    builder.advance(thought(' later', 'th1'), 120);
    builder.advance(text('boundary', 'm2'), 150);

    const item = nullthrow(builder.snapshot().items.find((entry) => entry.id === 'th1'));
    expect(item.kind).toBe('reasoning');
    if (item.kind === 'reasoning') {
      expect(item.startedAt).toBeUndefined();
      expect(item.endedAt).toBe(150);
      expect(item.receivedAt).toBe(120);
    }
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
