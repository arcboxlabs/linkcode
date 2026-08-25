import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function envelope(payload: unknown) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 1, payload };
}

describe('config wire schema — custom MCP servers', () => {
  it('round-trips a masked read projection on config.get.result', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'config.get.result',
        replyTo: 'request-1',
        providers: {},
        accounts: [],
        customMcpServers: [
          {
            id: 'custom-1',
            enabled: true,
            server: { type: 'http', name: 'search', url: 'https://mcp.example', headerKeys: [] },
            createdAt: 1,
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects a read projection carrying secret values instead of key lists', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'config.get.result',
        replyTo: 'request-1',
        providers: {},
        accounts: [],
        customMcpServers: [
          {
            id: 'custom-1',
            enabled: true,
            server: {
              type: 'http',
              name: 'search',
              url: 'https://mcp.example',
              headers: { Authorization: 'Bearer x' },
            },
            createdAt: 1,
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('accepts patch ops on config.set and leaves them optional', () => {
    expect(parseWireMessage(envelope({ kind: 'config.set', clientReqId: 'request-1' })).ok).toBe(
      true,
    );
    const parsed = parseWireMessage(
      envelope({
        kind: 'config.set',
        clientReqId: 'request-1',
        customMcpServers: [{ op: 'remove', id: 'custom-1' }],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it('rejects a config.set that updates more than one resource', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'config.set',
        clientReqId: 'request-1',
        providers: {},
        customMcpServers: [],
      }),
    );
    expect(parsed.ok).toBe(false);
  });

  it('carries optional mcp warnings on session.started', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'session.started',
        replyTo: 'request-1',
        sessionId: 'session-1',
        mcpWarnings: [{ serverName: 'github', reason: 'agent-unsupported' }],
      }),
    );
    expect(parsed.ok).toBe(true);
  });

  it('passes an unknown mcp warning reason through untouched (forward-compat)', () => {
    // A newer daemon may add reasons; an older reader must not drop the whole session.started
    // frame over one unrecognized value, so reason stays a bare non-empty string on the wire.
    const parsed = parseWireMessage(
      envelope({
        kind: 'session.started',
        replyTo: 'request-1',
        sessionId: 'session-1',
        mcpWarnings: [{ serverName: 'github', reason: 'broker-unavailable' }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.payload.kind === 'session.started') {
      expect(parsed.message.payload.mcpWarnings).toEqual([
        { serverName: 'github', reason: 'broker-unavailable' },
      ]);
    }
  });

  it('still rejects a malformed mcp warning', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'session.started',
        replyTo: 'request-1',
        sessionId: 'session-1',
        mcpWarnings: [{ serverName: 'github', reason: '' }],
      }),
    );
    expect(parsed.ok).toBe(false);
  });
});
