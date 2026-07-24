import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { SimulatorMcpProvider, SimulatorService } from '@linkcode/engine';
import type { McpServer as McpServerEntry, SessionId } from '@linkcode/schema';
// eslint-disable-next-line import-x/no-unresolved -- the SDK's exports-map subpaths (./server/*.js) defeat the resolver; tsc resolves them fine
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// eslint-disable-next-line import-x/no-unresolved -- same exports-map subpath as above
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { z } from 'zod';
import { logger } from '../logger';

/** `simulator.activity` broadcast hook — the panel's "agent is driving this device" badge. */
export type SimulatorActivityNotify = (activity: {
  sessionId: SessionId;
  udid?: string;
  tool: string;
  phase: 'started' | 'settled';
}) => void;

/** Broadcast hooks the daemon wires to the hub. `devicesChanged` mirrors the wire handler's
 * post-command push — agent-driven boots must move the panel's device list too. */
export interface SimulatorMcpNotifications {
  activity?: SimulatorActivityNotify;
  devicesChanged?: (devices: Awaited<ReturnType<SimulatorService['list']>>) => void;
}

const SERVER_NAME = 'linkcode-sim';
const RE_MCP_PATH = /^\/mcp\/([\w-]+)$/;

/**
 * The daemon's built-in simulator MCP endpoint (CODE-395): a loopback HTTP server speaking MCP
 * streamable-HTTP, one session-bound token per LinkCode session. Tools call the engine's
 * {@link SimulatorService} under that session, so agents obey the same ownership, caps, and
 * reclaim rules as wire clients — nothing here reaches around the policy layer to the sidecar.
 *
 * Requests are handled statelessly (a fresh server+transport per POST): agent SDK clients
 * re-initialize on reconnect anyway, and per-session state already lives in the engine.
 */
export class SimulatorMcpEndpoint implements SimulatorMcpProvider {
  private readonly tokens = new Map<string, SessionId>();
  private readonly tokenBySession = new Map<SessionId, string>();

  private constructor(
    private readonly server: Server,
    private readonly simulators: SimulatorService,
    private readonly notify?: SimulatorMcpNotifications,
  ) {}

  static create(
    this: void,
    simulators: SimulatorService,
    notify?: SimulatorMcpNotifications,
  ): Promise<SimulatorMcpEndpoint> {
    return new Promise((resolve, reject) => {
      let endpoint: SimulatorMcpEndpoint | undefined;
      const server = createServer((req, res) => {
        // handle() never rejects (it catches internally); the catch is stream-error paranoia.
        endpoint?.handle(req, res).catch(noop);
      });
      endpoint = new SimulatorMcpEndpoint(server, simulators, notify);
      server.once('error', reject);
      // Loopback only, ephemeral port: the endpoint carries no auth beyond its per-session
      // token path, so it must never be reachable off-host.
      server.listen(0, '127.0.0.1', () => resolve(nullthrow(endpoint)));
    });
  }

  private boundPort(): number {
    const address = this.server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('sim MCP endpoint is not listening');
    }
    return address.port;
  }

  endpointFor(sessionId: SessionId): McpServerEntry | undefined {
    let token = this.tokenBySession.get(sessionId);
    if (!token) {
      token = randomUUID();
      this.tokenBySession.set(sessionId, token);
      this.tokens.set(token, sessionId);
    }
    return {
      type: 'http',
      name: SERVER_NAME,
      url: `http://127.0.0.1:${this.boundPort()}/mcp/${token}`,
    };
  }

  release(sessionId: SessionId): void {
    const token = this.tokenBySession.get(sessionId);
    if (!token) return;
    this.tokenBySession.delete(sessionId);
    this.tokens.delete(token);
  }

  close(): void {
    this.tokens.clear();
    this.tokenBySession.clear();
    this.server.close();
  }

  /** Reached only through `create()`'s request closure — not via `this`, which the lint rule
   * tracks; keep it package-private by convention rather than `private`. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = RE_MCP_PATH.exec(req.url?.split('?', 1)[0] ?? '')?.[1];
    const sessionId = token === undefined ? undefined : this.tokens.get(token);
    if (sessionId === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown MCP endpoint' }));
      return;
    }
    if (req.method !== 'POST') {
      // Stateless mode: no SSE stream to GET, no MCP session to DELETE.
      res.writeHead(405).end();
      return;
    }
    try {
      const body: unknown = JSON.parse(await readBody(req));
      const server = this.buildServer(sessionId);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      logger.warn({ err, operation: 'sim.mcp' }, 'sim MCP request failed');
      if (!res.headersSent) res.writeHead(500).end();
    }
  }

  /** Best-effort mirror of the wire handler's post-command push; the tool already succeeded. */
  private async broadcastDevices(): Promise<void> {
    if (!this.notify?.devicesChanged) return;
    try {
      this.notify.devicesChanged(await this.simulators.list());
    } catch {
      // The next explicit list reconciles; failing the completed tool call would be worse.
    }
  }

  /** One MCP server per request, scoped to the token's session; tools are thin wrappers over the
   * engine service, so ownership conflicts and caps surface as tool errors the agent can read. */
  private buildServer(sessionId: SessionId): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: '1.0.0' });
    const simulators = this.simulators;
    const run = async (
      tool: string,
      udid: string | undefined,
      op: () => Promise<string>,
    ): Promise<{ content: [{ type: 'text'; text: string }]; isError?: true }> => {
      this.notify?.activity?.({ sessionId, udid, tool, phase: 'started' });
      try {
        return { content: [{ type: 'text', text: await op() }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: extractErrorMessage(err) ?? 'simulator call failed' }],
          isError: true,
        };
      } finally {
        this.notify?.activity?.({ sessionId, udid, tool, phase: 'settled' });
      }
    };

    server.registerTool(
      'sim_list_devices',
      {
        description:
          'List the available iOS Simulator devices with their udid, name, state (Booted/Shutdown), and runtime.',
        inputSchema: {},
      },
      () => run('sim_list_devices', undefined, async () => JSON.stringify(await simulators.list())),
    );
    server.registerTool(
      'sim_boot',
      {
        description:
          'Boot an iOS Simulator device by udid and wait until it is fully usable. Booting an already-booted device succeeds.',
        inputSchema: { udid: z.string().min(1) },
      },
      ({ udid }) =>
        run('sim_boot', udid, async () => {
          await simulators.boot(sessionId, udid);
          await this.broadcastDevices();
          return `booted ${udid}`;
        }),
    );
    server.registerTool(
      'sim_shutdown',
      {
        description: 'Shut down an iOS Simulator device by udid.',
        inputSchema: { udid: z.string().min(1) },
      },
      ({ udid }) =>
        run('sim_shutdown', udid, async () => {
          await simulators.shutdownDevice(sessionId, udid);
          await this.broadcastDevices();
          return `shut down ${udid}`;
        }),
    );
    server.registerTool(
      'sim_install',
      {
        description:
          'Install a built .app bundle onto a booted iOS Simulator device. appPath must be an absolute path to the .app directory (e.g. from DerivedData or xcodebuild -derivedDataPath).',
        inputSchema: { udid: z.string().min(1), appPath: z.string().min(1) },
      },
      ({ udid, appPath }) =>
        run('sim_install', udid, async () => {
          await simulators.install(sessionId, udid, appPath);
          return `installed ${appPath}`;
        }),
    );
    server.registerTool(
      'sim_launch',
      {
        description: 'Launch an installed app by bundle id on a booted iOS Simulator device.',
        inputSchema: { udid: z.string().min(1), bundleId: z.string().min(1) },
      },
      ({ udid, bundleId }) =>
        run('sim_launch', udid, async () => {
          const pid = await simulators.launch(sessionId, udid, bundleId);
          return pid === null ? `launched ${bundleId}` : `launched ${bundleId} (pid ${pid})`;
        }),
    );
    server.registerTool(
      'sim_terminate',
      {
        description: 'Terminate a running app by bundle id on an iOS Simulator device.',
        inputSchema: { udid: z.string().min(1), bundleId: z.string().min(1) },
      },
      ({ udid, bundleId }) =>
        run('sim_terminate', udid, async () => {
          await simulators.terminate(sessionId, udid, bundleId);
          return `terminated ${bundleId}`;
        }),
    );
    server.registerTool(
      'sim_open_url',
      {
        description:
          'Open a URL on a booted iOS Simulator device (deep links, or web pages in Safari).',
        inputSchema: { udid: z.string().min(1), url: z.string().min(1) },
      },
      ({ udid, url }) =>
        run('sim_open_url', udid, async () => {
          await simulators.openUrl(sessionId, udid, url);
          return `opened ${url}`;
        }),
    );
    server.registerTool(
      'sim_rotate',
      {
        description:
          'Rotate a booted iOS Simulator device to an interface orientation (portrait, portraitUpsideDown, landscapeLeft, landscapeRight), then re-screenshot to check the landscape/portrait layout. A foreground app that does not support the orientation keeps its current frame.',
        inputSchema: {
          udid: z.string().min(1),
          orientation: z.enum([
            'portrait',
            'portraitUpsideDown',
            'landscapeLeft',
            'landscapeRight',
          ]),
        },
      },
      ({ udid, orientation }) =>
        run('sim_rotate', udid, async () => {
          await simulators.rotate(sessionId, udid, orientation);
          return `rotated ${udid} to ${orientation}`;
        }),
    );
    server.registerTool(
      'sim_screenshot',
      {
        description:
          'Capture the current screen of a booted iOS Simulator device and return it as an image. Use this to see what the app looks like right now.',
        inputSchema: { udid: z.string().min(1), format: z.enum(['jpeg', 'png']).optional() },
      },
      async ({ udid, format }) => {
        const tool = 'sim_screenshot';
        this.notify?.activity?.({ sessionId, udid, tool, phase: 'started' });
        try {
          const chosen = format ?? 'jpeg';
          const image = await simulators.screenshot(sessionId, udid, chosen);
          return {
            content: [
              {
                type: 'image' as const,
                data: Buffer.from(image).toString('base64'),
                mimeType: chosen === 'jpeg' ? 'image/jpeg' : 'image/png',
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: extractErrorMessage(err) ?? 'simulator screenshot failed',
              },
            ],
            isError: true as const,
          };
        } finally {
          this.notify?.activity?.({ sessionId, udid, tool, phase: 'settled' });
        }
      },
    );
    return server;
  }
}

/** MCP tool calls are small JSON envelopes; cap the body so a buggy or hostile client on the
 * loopback endpoint can't grow it without bound and exhaust memory. */
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_MCP_BODY_BYTES) {
        aborted = true;
        req.destroy();
        reject(new Error('MCP request body exceeds the size limit'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}
