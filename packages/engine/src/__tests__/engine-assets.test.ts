import type { ManagedAssetStatus, WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import type { AssetService } from '../engine';
import { Engine } from '../engine';

function harness(assets?: AssetService) {
  const sent: WirePayload[] = [];
  let handler: ((msg: WireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const engine = new Engine(transport, { assets });
  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  return { engine, sent, inject };
}

describe('asset.list', () => {
  it('serves a live status snapshot from the injected service', async () => {
    const statuses: ManagedAssetStatus[] = [
      {
        id: 'agent:codex',
        wantedVersion: '0.140.0',
        installed: {
          id: 'agent:codex',
          version: '0.140.0',
          path: '/store/agent/codex/0.140.0/codex',
        },
      },
      { id: 'tool:tectonic', wantedVersion: '0.16.9' },
    ];
    const { engine, sent, inject } = harness({ statuses: () => statuses });
    await engine.start();
    inject({ kind: 'asset.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'asset.listed', replyTo: 'r1', assets: statuses });
  });

  it('serves an empty list when the host injected no asset service', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({ kind: 'asset.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'asset.listed', replyTo: 'r1', assets: [] });
  });
});
