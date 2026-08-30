import { WIRE_PROTOCOL_VERSION, WireMessageSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

describe('agent wire variants', () => {
  it.each([
    {
      type: 'agent-message',
      messageId: 'message-1',
      content: [{ type: 'text', text: 'authoritative body' }],
    },
    {
      type: 'agent-thought',
      messageId: 'thought-1',
    },
    {
      type: 'plan',
      plan: {
        planId: 'current',
        entries: [{ content: 'No longer needed', priority: 'low', status: 'cancelled' }],
      },
    },
    {
      type: 'prompt-response-status',
      requestId: 'permission-1',
      status: 'responding',
    },
    {
      type: 'permission-resolved',
      requestId: 'permission-1',
      outcome: { outcome: 'selected', optionId: 'allow' },
      source: 'user',
    },
    {
      type: 'question-resolved',
      requestId: 'question-1',
      outcome: { outcome: 'cancelled' },
      source: 'session',
    },
    { type: 'effort-update', effort: 'ultra' },
    {
      type: 'available-models-update',
      models: [
        {
          id: 'gpt-5.6-sol',
          label: 'GPT-5.6-Sol',
          effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          defaultEffort: 'low',
        },
      ],
    },
    {
      type: 'tool-call-content-chunk',
      toolCallId: 'tool-1',
      content: { type: 'content', content: { type: 'text', text: 'done' } },
    },
    {
      type: 'permission-request',
      requestId: 'permission-1',
      title: 'Run tests',
      description: 'Verify the current changes',
      subject: {
        type: 'command',
        command: 'pnpm test',
        cwd: '/repo',
        toolCallId: 'tool-1',
      },
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }],
    },
  ])('accepts $type through the complete wire envelope', (event) => {
    expect(
      WireMessageSchema.safeParse({
        v: WIRE_PROTOCOL_VERSION,
        id: 'message-1',
        ts: 0,
        payload: { kind: 'agent.event', sessionId: 'session-1', event },
      }).success,
    ).toBe(true);
  });

  it('accepts Codex ultra as input but rejects provider values outside the normalized vocabulary', () => {
    const message = {
      v: WIRE_PROTOCOL_VERSION,
      id: 'message-1',
      ts: 0,
      payload: {
        kind: 'agent.input',
        clientReqId: 'request-1',
        sessionId: 'session-1',
        input: { type: 'set-effort', effort: 'ultra' },
      },
    };
    expect(WireMessageSchema.safeParse(message).success).toBe(true);
    expect(
      WireMessageSchema.safeParse({
        ...message,
        payload: { ...message.payload, input: { type: 'set-effort', effort: 'minimal' } },
      }).success,
    ).toBe(false);
  });

  it('preserves image attachment names through the wire schema', () => {
    const parsed = WireMessageSchema.parse({
      v: WIRE_PROTOCOL_VERSION,
      id: 'message-1',
      ts: 0,
      payload: {
        kind: 'agent.input',
        clientReqId: 'request-1',
        sessionId: 'session-1',
        input: {
          type: 'prompt',
          content: [
            { type: 'image', data: 'cG5n', mimeType: 'image/png', name: 'architecture.png' },
          ],
        },
      },
    });

    expect(parsed).toMatchObject({
      payload: {
        input: { content: [{ name: 'architecture.png' }] },
      },
    });
  });

  it('requires identity on user messages', () => {
    expect(
      WireMessageSchema.safeParse({
        v: WIRE_PROTOCOL_VERSION,
        id: 'message-1',
        ts: 0,
        payload: {
          kind: 'agent.event',
          sessionId: 'session-1',
          event: { type: 'user-message', content: [{ type: 'text', text: 'hello' }] },
        },
      }).success,
    ).toBe(false);
  });
});
