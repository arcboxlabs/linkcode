import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

describe('terminal wire schema', () => {
  it('does not admit a client-supplied session owner on terminal.open', () => {
    const parsed = parseWireMessage({
      v: WIRE_PROTOCOL_VERSION,
      id: 'message-1',
      ts: 1,
      payload: {
        kind: 'terminal.open',
        clientReqId: 'request-1',
        opts: { cols: 80, rows: 24, sessionId: 'session-1' },
        attachmentId: 'attachment-1',
        attachmentSecret: 's'.repeat(32),
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.message.payload.kind).toBe('terminal.open');
    if (parsed.message.payload.kind !== 'terminal.open') {
      throw new Error(`expected terminal.open, received ${parsed.message.payload.kind}`);
    }
    expect(parsed.message.payload.opts).not.toHaveProperty('sessionId');
  });

  it('requires attachment credentials and a nonnegative cumulative count on terminal.ack', () => {
    const ack = (payload: Record<string, unknown>) =>
      parseWireMessage({ v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 1, payload });
    const valid = {
      kind: 'terminal.ack',
      terminalId: 'term-1',
      acked: 4096,
      attachmentId: 'attachment-1',
      attachmentSecret: 's'.repeat(32),
    };

    expect(ack(valid).ok).toBe(true);
    expect(ack({ ...valid, acked: -1 }).ok).toBe(false);
    expect(ack({ ...valid, acked: 1.5 }).ok).toBe(false);
    expect(ack({ ...valid, attachmentSecret: undefined }).ok).toBe(false);
  });
});
