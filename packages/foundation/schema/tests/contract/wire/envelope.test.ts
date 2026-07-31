import {
  MIN_COMPATIBLE_WIRE_VERSION,
  parseWireMessage,
  WIRE_PROTOCOL_VERSION,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function envelope(payload: unknown, v: number = WIRE_PROTOCOL_VERSION) {
  return { v, id: 'message-1', ts: 1, payload };
}

const ping = { kind: 'ping' };

describe('wire envelope compatibility', () => {
  it('accepts a frame from a newer peer as long as the payload is one it knows', () => {
    const parsed = parseWireMessage(envelope(ping, WIRE_PROTOCOL_VERSION + 5));

    expect(parsed.ok).toBe(true);
  });

  it('refuses a peer below the compatible floor, naming the version it spoke', () => {
    const parsed = parseWireMessage(envelope(ping, MIN_COMPATIBLE_WIRE_VERSION - 1));

    expect(parsed).toMatchObject({
      ok: false,
      reason: 'unsupported-version',
      version: MIN_COMPATIBLE_WIRE_VERSION - 1,
    });
  });

  it('drops only the unrecognized frame, not the ones around it', () => {
    const unknown = parseWireMessage(envelope({ kind: 'session.teleported', sessionId: 'sess-1' }));

    expect(unknown).toMatchObject({
      ok: false,
      reason: 'unknown-kind',
      kind: 'session.teleported',
    });
    // The point of the split parse: a neighbour on the same connection still gets through.
    expect(parseWireMessage(envelope(ping)).ok).toBe(true);
  });

  it('separates a malformed known payload from an unknown one', () => {
    const parsed = parseWireMessage(envelope({ kind: 'session.stop', clientReqId: 42 }));

    expect(parsed).toMatchObject({ ok: false, reason: 'invalid-payload', kind: 'session.stop' });
  });

  it('rejects anything that is not an envelope at all', () => {
    expect(parseWireMessage(null)).toMatchObject({ ok: false, reason: 'malformed-envelope' });
    expect(parseWireMessage({ v: WIRE_PROTOCOL_VERSION })).toMatchObject({
      ok: false,
      reason: 'malformed-envelope',
    });
    expect(parseWireMessage(envelope('not-an-object'))).toMatchObject({
      ok: false,
      reason: 'malformed-envelope',
    });
  });
});
