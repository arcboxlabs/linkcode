import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function sessionStart(effort: unknown) {
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 0,
    payload: {
      kind: 'session.start',
      clientReqId: 'request-1',
      opts: { kind: 'claude-code', cwd: '/repo', effort },
    },
  };
}

describe('session wire variants', () => {
  it('accepts a supported initial effort level', () => {
    expect(parseWireMessage(sessionStart('high')).success).toBe(true);
  });

  it('rejects an unknown initial effort level', () => {
    expect(parseWireMessage(sessionStart('extreme')).success).toBe(false);
  });
});
