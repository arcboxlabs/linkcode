import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function sessionStart(effort: unknown, branch?: unknown) {
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 0,
    payload: {
      kind: 'session.start',
      clientReqId: 'request-1',
      opts: {
        kind: 'claude-code',
        cwd: '/repo',
        effort,
        ...(!(branch === undefined) && { branch }),
      },
    },
  };
}

describe('session wire variants', () => {
  it('accepts a supported initial effort level', () => {
    expect(parseWireMessage(sessionStart('high')).ok).toBe(true);
  });

  it('rejects an unknown initial effort level', () => {
    expect(parseWireMessage(sessionStart('extreme')).ok).toBe(false);
  });

  it.each(['local', 'worktree'])('accepts an explicit %s branch mode', (mode) => {
    expect(parseWireMessage(sessionStart('high', { name: 'feature', mode })).ok).toBe(true);
  });

  it('rejects a branch without an explicit mode', () => {
    expect(parseWireMessage(sessionStart('high', { name: 'feature' })).ok).toBe(false);
  });
});
