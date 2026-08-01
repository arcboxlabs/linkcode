import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

describe('git wire schema', () => {
  it('accepts branch switch conflict details', () => {
    expect(
      parseWireMessage({
        v: WIRE_PROTOCOL_VERSION,
        id: 'message-1',
        ts: 1,
        payload: {
          kind: 'git.branch.switch.check.result',
          replyTo: 'request-1',
          check: {
            status: 'conflict',
            files: [{ path: 'src/a.ts', additions: 2, deletions: 1 }],
          },
        },
      }).ok,
    ).toBe(true);
  });
});
