import type { SessionId, ValidatedWireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { asyncNoop, noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { SimulatorBackend, SimulatorFrameListener } from '../simulator/backend';
import { SimulatorService } from '../simulator/service';
import { FakeAdapter, settleEngineTasks, startedSessionId } from './fixtures/session-harness';
import { createTestEngine } from './fixtures/test-engine';

function fakeBackend() {
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
    screenMask: vi.fn(() => Promise.resolve(new Uint8Array([0x89, 0x50]))),
    tap: vi.fn(asyncNoop),
    touch: vi.fn(asyncNoop),
    key: vi.fn(asyncNoop),
    swipe: vi.fn(asyncNoop),
    button: vi.fn(asyncNoop),
    streamStart: vi.fn(() =>
      Promise.resolve({ streaming: true as const, fps: 60, scale: 1, codec: 'jpeg' as const }),
    ),
    streamStop: vi.fn(asyncNoop),
    onFrame: vi.fn((_udid: string, _listener: SimulatorFrameListener) => noop),
    close: vi.fn(noop),
  } satisfies SimulatorBackend;
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
  const engine = createTestEngine(transport, {
    simulators: backend ? new SimulatorService(backend) : undefined,
    factory: () => new FakeAdapter(),
  });
  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    await settleEngineTasks();
  }
  function reply(replyTo: string): WirePayload | undefined {
    return sent.find((p) => 'replyTo' in p && p.replyTo === replyTo);
  }
  // Simulator commands are session-scoped and the engine rejects unknown sessions, so start a real
  // one and return its id.
  async function startSession(clientReqId: string): Promise<SessionId> {
    await inject({
      kind: 'session.start',
      clientReqId,
      opts: { kind: 'claude-code', cwd: '/repo' },
    });
    return startedSessionId(sent, clientReqId);
  }
  return { engine, sent, inject, reply, startSession };
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

    const s1 = await h.startSession('s1');
    await h.inject({
      kind: 'simulator.boot',
      clientReqId: 'boot',
      sessionId: s1,
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

    const s1 = await h.startSession('s1');
    await h.inject({
      kind: 'simulator.launch',
      clientReqId: 'go',
      sessionId: s1,
      udid: 'U-1',
      bundleId: 'com.example.app',
    });
    expect(h.reply('go')).toMatchObject({ kind: 'simulator.launched', pid: 77 });

    await h.inject({
      kind: 'simulator.screenshot',
      clientReqId: 'shot',
      sessionId: s1,
      udid: 'U-1',
    });
    expect(h.reply('shot')).toMatchObject({
      kind: 'simulator.screenshotted',
      format: 'jpeg',
      data: Buffer.from([0xff, 0xd8, 0x01]).toString('base64'),
    });

    // The device belongs to s1 now; a *different* live session's command must fail as a conflict.
    const s2 = await h.startSession('s2');
    await h.inject({
      kind: 'simulator.open-url',
      clientReqId: 'steal',
      sessionId: s2,
      udid: 'U-1',
      url: 'https://example.com',
    });
    expect(h.reply('steal')).toMatchObject({ kind: 'request.failed', code: 'conflict' });
    await h.engine.stop();
  });

  it('start subscribes frames and fans them out session-scoped; stop unsubscribes', async () => {
    const backend = fakeBackend();
    const h = harness(backend);
    await h.engine.start();

    await h.inject({
      kind: 'simulator.stream.start',
      clientReqId: 'ss',
      sessionId: 'session-1' as never,
      udid: 'U-1',
      scale: 0.5,
    });
    expect(h.reply('ss')).toMatchObject({
      kind: 'simulator.stream.started',
      udid: 'U-1',
      fps: 60,
      scale: 1,
    });

    // The handler subscribed a frame listener; a delivered frame becomes a session-scoped push.
    const listener = backend.onFrame.mock.calls.at(-1)?.[1];
    listener?.({ codec: 'jpeg', data: new Uint8Array([0xff, 0xd8, 0x01]), key: true });
    expect(h.sent.find((p) => p.kind === 'simulator.stream.frame')).toMatchObject({
      kind: 'simulator.stream.frame',
      sessionId: 'session-1',
      udid: 'U-1',
      codec: 'jpeg',
      key: true,
      data: Buffer.from([0xff, 0xd8, 0x01]).toString('base64'),
    });

    await h.inject({
      kind: 'simulator.stream.stop',
      clientReqId: 'sx',
      sessionId: 'session-1' as never,
      udid: 'U-1',
    });
    expect(h.reply('sx')).toMatchObject({ kind: 'request.succeeded' });
    expect(backend.streamStop).toHaveBeenCalledWith('U-1');
    await h.engine.stop();
  });
});
