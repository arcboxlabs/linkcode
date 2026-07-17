import { describe, expect, it } from 'vitest';
import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '../index';

function envelope(payload: unknown) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 1, payload };
}

describe('browser wire schema', () => {
  it('accepts a host registration with client-minted credentials', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'browser.host.register',
        clientReqId: 'request-1',
        hostId: 'host-1',
        hostSecret: 's'.repeat(32),
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects a command with an op outside the closed set', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'browser.command',
        commandId: 'command-1',
        op: 'tab.delete-cookies',
        args: {},
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('round-trips a failed command settlement with a closed error code', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'browser.command.result',
        commandId: 'command-1',
        result: {
          ok: false,
          error: { code: 'host-unavailable', message: 'no host', retryable: true },
        },
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.payload.kind !== 'browser.command.result') return;
    expect(parsed.data.payload.result.ok).toBe(false);
  });

  it('rejects a settlement with an unknown error code', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'browser.command.result',
        commandId: 'command-1',
        result: { ok: false, error: { code: 'mystery', message: 'x', retryable: false } },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('accepts the client-side execute request and its data-carrying reply', () => {
    const request = parseWireMessage(
      envelope({
        kind: 'browser.execute',
        clientReqId: 'request-1',
        op: 'tab.snapshot',
        args: { tabId: 'right-browser-1' },
      }),
    );
    expect(request.success).toBe(true);

    const reply = parseWireMessage(
      envelope({
        kind: 'browser.executed',
        replyTo: 'request-1',
        result: { ok: true, data: { nodes: [] } },
      }),
    );
    expect(reply.success).toBe(true);
  });
});
