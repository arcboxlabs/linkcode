import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function message(id: unknown) {
  return {
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 1,
    payload: { kind: 'asset.ensure', clientReqId: 'request-1', id },
  };
}

describe('managed-asset wire contract', () => {
  it('accepts discriminated object IDs', () => {
    expect(parseWireMessage(message({ kind: 'agent', name: 'codex' })).ok).toBe(true);
    expect(parseWireMessage(message({ kind: 'tool', name: 'tectonic' })).ok).toBe(true);
  });

  it('rejects legacy string IDs', () => {
    expect(parseWireMessage(message('agent:codex')).ok).toBe(false);
    expect(parseWireMessage(message('tool:tectonic')).ok).toBe(false);
  });
});
