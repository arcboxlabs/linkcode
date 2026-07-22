import type { ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { asyncNoop, noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { SimulatorBackend } from '../simulator/backend';
import { settleEngineTasks } from './fixtures/session-harness';
import { createTestEngine } from './fixtures/test-engine';

function fakeBackend(): SimulatorBackend {
  const devices = [
    {
      udid: 'U-1',
      name: 'iPhone 17',
      state: 'Shutdown',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      deviceType: null,
    },
  ];
  return {
    probe: vi.fn(() => Promise.resolve({ simctlPath: '/usr/bin/simctl', developerDir: '/dev' })),
    list: vi.fn(() => Promise.resolve(devices)),
    boot: vi.fn(() => {
      devices[0] = { ...devices[0], state: 'Booted' };
      return Promise.resolve();
    }),
    shutdownDevice: vi.fn(asyncNoop),
    install: vi.fn(asyncNoop),
    launch: vi.fn(() => Promise.resolve<number | null>(77)),
    terminate: vi.fn(asyncNoop),
    openUrl: vi.fn(asyncNoop),
    screenshot: vi.fn(() => Promise.resolve(new Uint8Array([0xff, 0xd8, 0x01]))),
    close: vi.fn(noop),
  };
}

function harness(backend?: SimulatorBackend) {
  const sent: WirePayload[] = [];
  let handler: ((msg: ValidatedWireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: ValidatedWireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const engine = createTestEngine(transport, { simulatorBackend: backend });
  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    await settleEngineTasks();
  }
  function reply(replyTo: string): WirePayload | undefined {
    return sent.find((p) => 'replyTo' in p && p.replyTo === replyTo);
  }
  return { engine, sent, inject, reply };
}

describe('simulator wire requests', () => {
  it('reports unavailable without a backend and rejects commands as unsupported', async () => {
    const h = harness();
    await h.engine.start();

    await h.inject({ kind: 'simulator.status', clientReqId: 'st' });
    expect(h.reply('st')).toMatchObject({
      kind: 'simulator.status.result',
      status: { available: false },
    });

    await h.inject({
      kind: 'simulator.boot',
      clientReqId: 'boot',
      sessionId: 'session-1' as never,
      udid: 'U-1',
    });
    expect(h.reply('boot')).toMatchObject({ kind: 'request.failed', code: 'unsupported' });
    await h.engine.stop();
  });

  it('serves status, list, and the boot → devices.changed flow', async () => {
    const h = harness(fakeBackend());
    await h.engine.start();

    await h.inject({ kind: 'simulator.status', clientReqId: 'st' });
    expect(h.reply('st')).toMatchObject({
      kind: 'simulator.status.result',
      status: { available: true, simctlPath: '/usr/bin/simctl' },
    });

    await h.inject({ kind: 'simulator.list', clientReqId: 'ls' });
    expect(h.reply('ls')).toMatchObject({
      kind: 'simulator.listed',
      devices: [{ udid: 'U-1', state: 'Shutdown' }],
    });

    await h.inject({
      kind: 'simulator.boot',
      clientReqId: 'boot',
      sessionId: 'session-1' as never,
      udid: 'U-1',
    });
    expect(h.reply('boot')).toMatchObject({ kind: 'request.succeeded' });
    const changed = h.sent.find((p) => p.kind === 'simulator.devices.changed');
    expect(changed).toMatchObject({ devices: [{ udid: 'U-1', state: 'Booted' }] });
    await h.engine.stop();
  });

  it('routes launch and screenshot replies and enforces cross-session ownership', async () => {
    const h = harness(fakeBackend());
    await h.engine.start();

    await h.inject({
      kind: 'simulator.launch',
      clientReqId: 'go',
      sessionId: 'session-1' as never,
      udid: 'U-1',
      bundleId: 'com.example.app',
    });
    expect(h.reply('go')).toMatchObject({ kind: 'simulator.launched', pid: 77 });

    await h.inject({
      kind: 'simulator.screenshot',
      clientReqId: 'shot',
      sessionId: 'session-1' as never,
      udid: 'U-1',
    });
    expect(h.reply('shot')).toMatchObject({
      kind: 'simulator.screenshotted',
      format: 'jpeg',
      data: Buffer.from([0xff, 0xd8, 0x01]).toString('base64'),
    });

    // The device belongs to session-1 now; another session's command must fail as a conflict.
    await h.inject({
      kind: 'simulator.open-url',
      clientReqId: 'steal',
      sessionId: 'session-2' as never,
      udid: 'U-1',
      url: 'https://example.com',
    });
    expect(h.reply('steal')).toMatchObject({ kind: 'request.failed', code: 'conflict' });
    await h.engine.stop();
  });
});
