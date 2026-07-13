import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the delegate helper reports for one tool call (see delegate-helper.mjs). */
export interface AmpPermissionRequest {
  toolName: string;
  toolUseId: string;
  threadId?: string;
  args: unknown;
}

/** A running loopback bridge the amp delegate helper POSTs to; scoped to one AmpAdapter/session. */
export interface AmpPermissionBridge {
  /** `http://127.0.0.1:<port>/permission` — injected into the amp CLI env so the helper can reach it. */
  url: string;
  /** Random per-session secret; the helper echoes it in `x-amp-bridge-token` and mismatches are 403'd. */
  token: string;
  close: () => Promise<void>;
}

async function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  let body = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) body += chunk;
  return body;
}

/**
 * Start an ephemeral loopback HTTP server the amp `delegate` helper calls to get a per-tool decision.
 * The amp CLI spawns the helper as a detached grandchild with no way back into the daemon's address
 * space, so this is the round-trip channel: helper → POST /permission → `decide` (which runs the real
 * `requestPermission` approval round-trip in the adapter) → `{decision}` back → helper's exit code.
 *
 * Bound to 127.0.0.1 only, gated by a random token, and `unref`'d so it never keeps the daemon alive.
 * Fails CLOSED: any malformed/unauthorized request answers `deny`.
 */
export async function startAmpPermissionBridge(
  decide: (req: AmpPermissionRequest) => Promise<'allow' | 'deny'>,
): Promise<AmpPermissionBridge> {
  const token = randomBytes(24).toString('hex');
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/permission') {
        res.writeHead(404).end();
        return;
      }
      if (req.headers['x-amp-bridge-token'] !== token) {
        res.writeHead(403).end();
        return;
      }
      let decision: 'allow' | 'deny' = 'deny';
      try {
        const parsed: unknown = JSON.parse(await readBody(req));
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as AmpPermissionRequest).toolName === 'string' &&
          typeof (parsed as AmpPermissionRequest).toolUseId === 'string'
        ) {
          const body = parsed as AmpPermissionRequest;
          decision = await decide({
            toolName: body.toolName,
            toolUseId: body.toolUseId,
            threadId: typeof body.threadId === 'string' ? body.threadId : undefined,
            args: body.args,
          });
        }
      } catch {
        decision = 'deny';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision }));
    })();
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  server.unref();
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/permission`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
