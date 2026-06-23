import { parseWireMessage } from '@linkcode/schema';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';

/**
 * Link Code Server — relay / tunnel (PLAN §4.7).
 * It does not run an agent itself; it only lets external devices (Mobile) connect to the local Host.
 * Both Host ↔ Server and Mobile ↔ Server use websockets carrying the WireMessage defined by schema.
 *
 * ❓ The data models / protocol details for the following capabilities are still to be confirmed (PLAN §10.7);
 *   this is only a minimal skeleton for now:
 *   - token    authentication: validate the token on connection to identify the user / device.
 *   - perm     permissions: authorization policy for tool calls.
 *   - store    storage: persistence of session history.
 *   - realtime real-time: presence / multi-device synchronization.
 *
 * The current tunnel is a placeholder implementation that broadcasts between host ↔ client within the same room;
 * it does not yet route precisely by tunnel id / session.
 */

type Role = 'host' | 'client';

const PORT = Number(process.env.PORT ?? 8787);

const hosts = new Set<WebSocket>();
const clients = new Set<WebSocket>();

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket, req) => {
  // TODO(token): parse and validate the authentication token from req.headers / url query.
  const url = new URL(req.url ?? '/', 'ws://localhost');
  const role: Role = url.searchParams.get('role') === 'host' ? 'host' : 'client';

  const peers = role === 'host' ? hosts : clients;
  const targets = role === 'host' ? clients : hosts;
  peers.add(socket);

  socket.on('message', (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(rawDataToString(data));
    } catch {
      return; // not JSON, discard
    }
    // Trust boundary: validate with zod before forwarding (PLAN §2.1).
    const parsed = parseWireMessage(raw);
    if (!parsed.success) return;

    const serialized = JSON.stringify(parsed.data);
    for (const target of targets) {
      if (target.readyState === target.OPEN) target.send(serialized);
    }
  });

  socket.on('close', () => {
    peers.delete(socket);
  });
});

console.log(`[link-code/server] tunnel listening on ws://localhost:${PORT}`);

function rawDataToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return Buffer.from(data).toString('utf8');
}
