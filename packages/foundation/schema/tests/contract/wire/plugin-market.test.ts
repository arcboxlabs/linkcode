import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function envelope(payload: unknown) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'message-1', ts: 1, payload };
}

const marketplace = {
  id: 'linkcode-official',
  displayName: 'LinkCode Official',
  source: { type: 'remote', url: 'https://plugins.linkcode.ai/index.json' },
  enabled: true,
};

const release = {
  manifest: {
    manifestVersion: 1,
    id: 'arcbox/latex',
    version: '1.2.0',
    keywords: [],
    components: [{ kind: 'skill', name: 'latex', entry: 'skills/latex/SKILL.md' }],
    assets: [],
  },
  artifact: {
    urls: ['https://plugins.linkcode.ai/arcbox/latex/1.2.0.tgz'],
    integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
    format: 'tgz',
  },
};

const identity = { marketplaceId: 'linkcode-official', pluginId: 'arcbox/latex', version: '1.2.0' };

describe('plugin-market wire schema', () => {
  it('round-trips the list request and its reply', () => {
    expect(
      parseWireMessage(envelope({ kind: 'plugin-market.list.get', clientReqId: 'request-1' })).ok,
    ).toBe(true);

    const reply = parseWireMessage(
      envelope({ kind: 'plugin-market.listed', replyTo: 'request-1', marketplaces: [marketplace] }),
    );
    expect(reply.ok).toBe(true);
    if (!reply.ok || reply.message.payload.kind !== 'plugin-market.listed') return;
    expect(reply.message.payload.marketplaces).toHaveLength(1);
  });

  it('round-trips a refresh request and both refresh reply shapes', () => {
    expect(
      parseWireMessage(
        envelope({
          kind: 'plugin-market.refresh',
          clientReqId: 'request-1',
          marketplaceId: 'linkcode-official',
        }),
      ).ok,
    ).toBe(true);

    const updated = parseWireMessage(
      envelope({
        kind: 'plugin-market.refreshed',
        replyTo: 'request-1',
        marketplaceId: 'linkcode-official',
        releases: [{ pluginId: 'arcbox/latex', release }],
      }),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok || updated.message.payload.kind !== 'plugin-market.refreshed') return;
    expect(updated.message.payload.releases).toHaveLength(1);

    const notModified = parseWireMessage(
      envelope({
        kind: 'plugin-market.refreshed',
        replyTo: 'request-1',
        marketplaceId: 'linkcode-official',
        releases: [],
        notModified: true,
      }),
    );
    expect(notModified.ok).toBe(true);
  });

  it('round-trips install and uninstall requests with their replies', () => {
    expect(
      parseWireMessage(
        envelope({ kind: 'plugin-market.install', clientReqId: 'request-1', release: identity }),
      ).ok,
    ).toBe(true);
    expect(
      parseWireMessage(
        envelope({
          kind: 'plugin-market.uninstall',
          clientReqId: 'request-1',
          pluginId: 'arcbox/latex',
        }),
      ).ok,
    ).toBe(true);

    const installed = parseWireMessage(
      envelope({ kind: 'plugin-market.installed', replyTo: 'request-1', ...identity }),
    );
    expect(installed.ok).toBe(true);
    if (!installed.ok || installed.message.payload.kind !== 'plugin-market.installed') return;
    expect(installed.message.payload.version).toBe('1.2.0');

    expect(
      parseWireMessage(
        envelope({
          kind: 'plugin-market.uninstalled',
          replyTo: 'request-1',
          pluginId: 'arcbox/latex',
        }),
      ).ok,
    ).toBe(true);
  });

  it('rejects an install identity from a non-HTTPS-configured marketplace id shape', () => {
    const parsed = parseWireMessage(
      envelope({
        kind: 'plugin-market.install',
        clientReqId: 'request-1',
        release: { ...identity, pluginId: 'not-a-plugin-id' },
      }),
    );
    expect(parsed.ok).toBe(false);
  });
});
