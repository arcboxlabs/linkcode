import type { SimulatorBackend } from '@linkcode/engine';
import { SimulatorService } from '@linkcode/engine';
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

function fakeBackend(): SimulatorBackend {
  return {
    probe: vi.fn(() => Promise.resolve({ simctlPath: '/usr/bin/simctl', developerDir: '/dev' })),
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
    swipe: vi.fn(asyncNoop),
    button: vi.fn(asyncNoop),
    streamStart: vi.fn(() => Promise.resolve({ streaming: true as const, fps: 60, scale: 1 })),
    streamStop: vi.fn(asyncNoop),
    onFrame: vi.fn(() => noop),
    close: vi.fn(noop),
  };
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
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(fakeBackend()), {
      activity(a) {
        activity.push(`${a.tool}:${a.phase}:${a.sessionId}`);
      },
    });
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
      'sim_screenshot',
      'sim_shutdown',
      'sim_terminate',
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

  it('enforces cross-session ownership through the shared service', async () => {
    const service = new SimulatorService(fakeBackend());
    endpoint = await SimulatorMcpEndpoint.create(service);
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

  it('rejects unknown tokens and released sessions', async () => {
    endpoint = await SimulatorMcpEndpoint.create(new SimulatorService(fakeBackend()));
    const url = urlOf(endpoint.endpointFor(S1));
    endpoint.release(S1);
    await expect(connect(url)).rejects.toThrow();
  });
});
