import { WIRE_PROTOCOL_VERSION, WireMessageSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

describe('agent wire variants', () => {
  it.each([
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
});
