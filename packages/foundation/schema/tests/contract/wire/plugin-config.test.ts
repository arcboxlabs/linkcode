import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function envelope(payload: unknown) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 1, payload };
}

const pluginView = {
  id: 'linkcode/mail',
  version: '1.0.0',
  settings: {
    account: { type: 'string', required: true },
    authcode: { type: 'password', secret: true, required: true },
  },
  values: { account: 'you@163.com' },
};

describe('plugin-config wire schema', () => {
  it('round-trips the masked list with secret presence bits', () => {
    const reply = parseWireMessage(
      envelope({
        kind: 'plugin-config.listed',
        replyTo: 'request-1',
        plugins: [{ ...pluginView, configuredSecrets: ['authcode'] }],
      }),
    );
    expect(reply.ok).toBe(true);
    if (!reply.ok || reply.message.payload.kind !== 'plugin-config.listed') return;
    expect(reply.message.payload.plugins[0]?.configuredSecrets).toEqual(['authcode']);
    expect(reply.message.payload.plugins[0]?.values).toEqual({ account: 'you@163.com' });
  });

  it('rejects replies without the presence bits, so absence fails loudly', () => {
    // The field has no shipped-daemon history to stay compatible with, and an absent field would
    // silently reopen the blank-required-secret bug through lenient fallbacks.
    expect(
      parseWireMessage(
        envelope({ kind: 'plugin-config.listed', replyTo: 'request-1', plugins: [pluginView] }),
      ).ok,
    ).toBe(false);
    expect(
      parseWireMessage(
        envelope({
          kind: 'plugin-config.updated',
          replyTo: 'request-1',
          pluginId: 'linkcode/mail',
          values: {},
        }),
      ).ok,
    ).toBe(false);
  });

  it('round-trips a per-key patch and its updated reply', () => {
    expect(
      parseWireMessage(
        envelope({
          kind: 'plugin-config.set',
          clientReqId: 'request-1',
          pluginId: 'linkcode/mail',
          set: { account: 'me@qq.com' },
          remove: ['preset'],
        }),
      ).ok,
    ).toBe(true);

    const reply = parseWireMessage(
      envelope({
        kind: 'plugin-config.updated',
        replyTo: 'request-1',
        pluginId: 'linkcode/mail',
        values: { account: 'me@qq.com' },
        configuredSecrets: [],
      }),
    );
    expect(reply.ok).toBe(true);
    if (!reply.ok || reply.message.payload.kind !== 'plugin-config.updated') return;
    expect(reply.message.payload.configuredSecrets).toEqual([]);
  });
});
