import type { SessionId, WirePayload } from '@linkcode/schema';
import { deliveryOf, WIRE_DELIVERY, WIRE_PAYLOAD_KINDS } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

const terminalOutput: WirePayload = {
  kind: 'terminal.output',
  terminalId: 'term-1',
  seq: 1,
  data: 'hi',
};
const agentEvent: WirePayload = {
  kind: 'agent.event',
  sessionId: 'sess-1' as SessionId,
  event: { type: 'status', status: 'idle' },
};

describe('wire delivery table', () => {
  it('names only frames the union actually carries', () => {
    const unknown = Object.keys(WIRE_DELIVERY).filter((kind) => !WIRE_PAYLOAD_KINDS.has(kind));

    expect(unknown).toEqual([]);
  });

  it('leaves an ordinary frame to every connection', () => {
    expect(deliveryOf({ kind: 'session.listed', replyTo: 'r1', sessions: [] })).toBeNull();
  });

  it('reads the id a scoped frame is routed by', () => {
    const terminal = deliveryOf(terminalOutput);
    const session = deliveryOf(agentEvent);

    // The accessors are what the Hub routes on, and an id lifted from the neighbouring field would
    // still typecheck — both are strings.
    expect(terminal?.scope).toBe('terminal');
    expect(terminal?.scope === 'terminal' && terminal.terminalId(terminalOutput)).toBe('term-1');
    expect(session?.scope).toBe('session');
    expect(session?.scope === 'session' && session.sessionId(agentEvent)).toBe('sess-1');
  });
});
