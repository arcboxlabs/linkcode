import type { SimulatorBackend } from '@linkcode/engine';
import { SimulatorConsentService, SimulatorService } from '@linkcode/engine';
import type { McpServer, SessionId } from '@linkcode/schema';
// eslint-disable-next-line import-x/no-unresolved -- the SDK's exports-map subpaths defeat the resolver; tsc resolves them fine
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// eslint-disable-next-line import-x/no-unresolved -- same exports-map subpath as above
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { asyncNoop, noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulatorMcpEndpoint } from '../sim/mcp-endpoint';

const S1 = 'session-1' as SessionId;
const S2 = 'session-2' as SessionId;

/** `satisfies` rather than a return annotation: it still checks the full backend contract, but
 * keeps the inferred mock types so call assertions read the spies directly. */
function fakeBackend() {
  return {
    probe: vi.fn(() =>
      Promise.resolve({ simctlPath: '/usr/bin/simctl', developerDir: '/dev', interactive: true }),
    ),
    list: vi.fn(() =>
      Promise.resolve([
        {
          udid: 'U-1',
          name: 'iPhone 17',
          state: 'Shutdown',
          runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
          deviceType: null,
        },
      ]),
    ),
    boot: vi.fn(asyncNoop),
    shutdownDevice: vi.fn(asyncNoop),
    install: vi.fn(asyncNoop),
    launch: vi.fn(() => Promise.resolve<number | null>(77)),
    terminate: vi.fn(asyncNoop),
    openUrl: vi.fn(asyncNoop),
    screenshot: vi.fn(() => Promise.resolve(new Uint8Array([0xff, 0xd8, 0x02]))),
    screenMask: vi.fn(() => Promise.resolve(new Uint8Array([0x89, 0x50]))),
    tap: vi.fn(asyncNoop),
    touch: vi.fn(asyncNoop),
    pinch: vi.fn(asyncNoop),
    paste: vi.fn(asyncNoop),
    key: vi.fn(asyncNoop),
    swipe: vi.fn(asyncNoop),
    button: vi.fn(asyncNoop),
    rotate: vi.fn(asyncNoop),
    streamStart: vi.fn(() =>
      Promise.resolve({ streaming: true as const, fps: 60, scale: 1, codec: 'jpeg' as const }),
    ),
    streamStop: vi.fn(asyncNoop),
    onFrame: vi.fn(() => noop),
    close: vi.fn(noop),
  } satisfies SimulatorBackend;
}

/** Consent pre-granted for the fixture device, so a test exercises the tools and not the gate. */
async function granted(udid = 'U-1'): Promise<SimulatorConsentService> {
  const consent = new SimulatorConsentService();
  await consent.decide(udid, 'granted');
  return consent;
}

function urlOf(entry: McpServer | undefined): string {
  if (entry?.type !== 'http') throw new Error('expected an http MCP endpoint');
  return entry.url;
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe('SimulatorMcpEndpoint', () => {
  let endpoint: SimulatorMcpEndpoint | undefined;

  afterEach(() => {
    endpoint?.close();
    endpoint = undefined;
  });

  it('serves session-scoped tools over MCP streamable http', async () => {
    const activity: string[] = [];
    endpoint = await SimulatorMcpEndpoint.create(
      new SimulatorService(fakeBackend()),
      await granted(),
      {
        activity(a) {
          activity.push(`${a.tool}:${a.phase}:${a.sessionId}`);
        },
      },
    );
    const entry = endpoint.endpointFor(S1);
    expect(entry).toMatchObject({ type: 'http', name: 'linkcode-sim' });

    const client = await connect(urlOf(entry));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'sim_boot',
      'sim_install',
      'sim_launch',
      'sim_list_devices',
      'sim_open_url',
      'sim_press_key',
      'sim_rotate',
      'sim_screenshot',
      'sim_shutdown',
      'sim_swipe',
      'sim_tap',
      'sim_terminate',
      'sim_type_text',
    ]);

    const listed = await client.callTool({ name: 'sim_list_devices', arguments: {} });
    expect(JSON.stringify(listed.content)).toContain('U-1');

    const shot = await client.callTool({
      name: 'sim_screenshot',
      arguments: { udid: 'U-1' },
    });
    expect(shot.content).toEqual([
      {
        type: 'image',
        data: Buffer.from([0xff, 0xd8, 0x02]).toString('base64'),
        mimeType: 'image/jpeg',
      },
    ]);
    expect(activity).toContain('sim_screenshot:started:session-1');
    expect(activity).toContain('sim_screenshot:settled:session-1');
    await client.close();
  });

  it('drives input on the normalized coordinate contract', async () => {
    const backend = fakeBackend();
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(backend), await granted());
    const client = await connect(urlOf(endpoint.endpointFor(S1)));

    await client.callTool({ name: 'sim_tap', arguments: { udid: 'U-1', x: 0.5, y: 0.25 } });
    expect(backend.tap).toHaveBeenCalledWith('U-1', 0.5, 0.25);

    await client.callTool({
      name: 'sim_swipe',
      arguments: { udid: 'U-1', fromX: 0.5, fromY: 0.8, toX: 0.5, toY: 0.2, durationMs: 300 },
    });
    expect(backend.swipe).toHaveBeenCalledWith('U-1', { x: 0.5, y: 0.8 }, { x: 0.5, y: 0.2 }, 300);

    // Passing screenshot pixels is the predictable agent mistake; the schema must reject them
    // rather than clamp them into a corner tap that looks like it worked.
    const pixels = await client.callTool({
      name: 'sim_tap',
      arguments: { udid: 'U-1', x: 600, y: 1200 },
    });
    expect(pixels.isError).toBe(true);
    expect(backend.tap).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it('types through the pasteboard so non-US-layout text works', async () => {
    const backend = fakeBackend();
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(backend), await granted());
    const client = await connect(urlOf(endpoint.endpointFor(S1)));

    await client.callTool({ name: 'sim_type_text', arguments: { udid: 'U-1', text: '你好 🎉' } });
    expect(backend.paste).toHaveBeenCalledWith('U-1', '你好 🎉');
    // Command+V commits it: the HID key path is a US-layout table that cannot express this text.
    expect(backend.key).toHaveBeenCalledWith('U-1', 25, [227]);

    await client.callTool({ name: 'sim_press_key', arguments: { udid: 'U-1', key: 'enter' } });
    expect(backend.key).toHaveBeenLastCalledWith('U-1', 40, []);
    await client.close();
  });

  it('enforces cross-session ownership through the shared service', async () => {
    const service = new SimulatorService(fakeBackend());
    endpoint = await SimulatorMcpEndpoint.create(service, await granted());
    const first = await connect(urlOf(endpoint.endpointFor(S1)));
    const second = await connect(urlOf(endpoint.endpointFor(S2)));

    const claimed = await first.callTool({
      name: 'sim_launch',
      arguments: { udid: 'U-1', bundleId: 'com.example' },
    });
    expect(claimed.isError).toBeFalsy();

    const stolen = await second.callTool({
      name: 'sim_launch',
      arguments: { udid: 'U-1', bundleId: 'com.example' },
    });
    expect(stolen.isError).toBe(true);
    expect(JSON.stringify(stolen.content)).toContain('in use by another session');
    await first.close();
    await second.close();
  });

  it('suspends an agent tool on an unknown device until the user answers', async () => {
    const consent = new SimulatorConsentService();
    const asked: string[] = [];
    consent.setHooks({
      ask(_sessionId, udid, tool) {
        asked.push(`${tool}:${udid}`);
        return true;
      },
      publish: noop,
    });
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(fakeBackend()), consent);
    const client = await connect(urlOf(endpoint.endpointFor(S1)));

    const call = client.callTool({ name: 'sim_boot', arguments: { udid: 'U-1' } });
    // The tool must still be in flight: it is waiting on the prompt, not failing fast.
    await vi.waitFor(() => expect(asked).toEqual(['sim_boot:U-1']));
    await consent.decide('U-1', 'granted');
    expect((await call).isError).toBeFalsy();

    // The decision is remembered, so the next call goes straight through without asking again.
    const second = await client.callTool({ name: 'sim_boot', arguments: { udid: 'U-1' } });
    expect(second.isError).toBeFalsy();
    expect(asked).toEqual(['sim_boot:U-1']);
    await client.close();
  });

  it('refuses a denied device and tells the agent not to retry', async () => {
    const consent = new SimulatorConsentService();
    await consent.decide('U-1', 'denied');
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(fakeBackend()), consent);
    const client = await connect(urlOf(endpoint.endpointFor(S1)));

    const refused = await client.callTool({ name: 'sim_boot', arguments: { udid: 'U-1' } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('do not retry');
    await client.close();
  });

  it('refuses everything while the global kill switch is off, including device-less tools', async () => {
    const consent = await granted();
    await consent.setAgentToolsEnabled(false);
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(fakeBackend()), consent);
    const client = await connect(urlOf(endpoint.endpointFor(S1)));

    const listed = await client.callTool({ name: 'sim_list_devices', arguments: {} });
    expect(listed.isError).toBe(true);
    expect(JSON.stringify(listed.content)).toContain('disabled for agents');

    // And it lifts again without a restart.
    await consent.setAgentToolsEnabled(true);
    expect(
      (await client.callTool({ name: 'sim_list_devices', arguments: {} })).isError,
    ).toBeFalsy();
    await client.close();
  });

  it('refuses an unknown device outright when no client is attached to ask', async () => {
    // `ask` reporting false is the daemon's "nobody is listening" signal; blocking for the full
    // timeout there would look like a hang to the agent.
    const consent = new SimulatorConsentService();
    consent.setHooks({ ask: () => false, publish: noop });
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(fakeBackend()), consent);
    const client = await connect(urlOf(endpoint.endpointFor(S1)));

    const refused = await client.callTool({ name: 'sim_boot', arguments: { udid: 'U-1' } });
    expect(refused.isError).toBe(true);
    await client.close();
  });

  it('rejects unknown tokens and released sessions', async () => {
    endpoint = await SimulatorMcpEndpoint.create(
      new SimulatorService(fakeBackend()),
      await granted(),
    );
    const url = urlOf(endpoint.endpointFor(S1));
    endpoint.release(S1);
    await expect(connect(url)).rejects.toThrow();
  });
});
