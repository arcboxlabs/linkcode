import { parseWireMessage } from '@linkcode/schema';
import type { RawData, WebSocket } from 'ws';
import { WebSocketServer } from 'ws';

/**
 * Link Code Server — relay/tunnel placeholder (docs/ARCHITECTURE.md#packages--repo-layout):
 * runs no agent, only relays schema WireMessages over websockets between Host and external
 * clients, room-broadcast (no per-tunnel/session routing yet). Token auth, permissions,
 * storage, and realtime sync are open questions (docs/ARCHITECTURE.md#open-questions).
 */

type Role = 'host' | 'client';

const PORT = Number(process.env.PORT ?? 8787);
const textDecoder = new TextDecoder();

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
    // Trust boundary: validate with zod before forwarding (docs/ARCHITECTURE.md#core-principles).
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
  return textDecoder.decode(Array.isArray(data) ? Buffer.concat(data) : data);
}
