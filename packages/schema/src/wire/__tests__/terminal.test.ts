import { describe, expect, it } from 'vitest';
import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '../index';

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

    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.payload.kind !== 'terminal.open') return;
    expect(parsed.data.payload.opts).not.toHaveProperty('sessionId');
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

    expect(ack(valid).success).toBe(true);
    expect(ack({ ...valid, acked: -1 }).success).toBe(false);
    expect(ack({ ...valid, acked: 1.5 }).success).toBe(false);
    expect(ack({ ...valid, attachmentSecret: undefined }).success).toBe(false);
  });
});
