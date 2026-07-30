import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function requestFailure(metadata: Record<string, unknown> = {}): unknown {
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 1,
    payload: {
      kind: 'request.failed',
      replyTo: 'request-1',
      message: 'Session is busy',
      code: 'conflict',
      ...metadata,
    },
  };
}

describe('request failure wire schema', () => {
  it('accepts a failure already reported in the conversation', () => {
    expect(parseWireMessage(requestFailure({ reportedInConversation: true })).success).toBe(true);
  });

  it('uses absence, not false, for a failure without a conversation event', () => {
    expect(parseWireMessage(requestFailure()).success).toBe(true);
    expect(parseWireMessage(requestFailure({ reportedInConversation: false })).success).toBe(false);
  });
});
