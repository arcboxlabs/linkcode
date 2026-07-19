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
});
