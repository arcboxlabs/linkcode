import { parseWireMessage } from '@linkcode/schema';
import { type WebSocket, WebSocketServer } from 'ws';

/**
 * Link Code Server —— 中转 / 隧道（PLAN §4.7）。
 * 本身不跑 agent，只负责让外网设备（Mobile）连到本地 Host。
 * Host ↔ Server、Mobile ↔ Server 都走 websocket，承载 schema 定义的 WireMessage。
 *
 * ❓ 以下能力的数据模型 / 协议细节均待确认（PLAN §10.7），当前仅为最小骨架：
 *   - token   鉴权：连接时校验 token，识别用户 / 设备。
 *   - perm    权限：工具调用授权策略。
 *   - store   存储：会话历史持久化。
 *   - realtime 实时：在线状态 / 多端同步。
 *
 * 当前隧道为「同一房间内 host ↔ client 广播」的占位实现，
 * 尚未按 tunnel id / session 精确路由。
 */

type Role = 'host' | 'client';

const PORT = Number(process.env.PORT ?? 8787);

const hosts = new Set<WebSocket>();
const clients = new Set<WebSocket>();

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket, req) => {
  // TODO(token): 从 req.headers / url query 解析并校验鉴权 token。
  const url = new URL(req.url ?? '/', 'ws://localhost');
  const role: Role = url.searchParams.get('role') === 'host' ? 'host' : 'client';

  const peers = role === 'host' ? hosts : clients;
  const targets = role === 'host' ? clients : hosts;
  peers.add(socket);

  socket.on('message', (data) => {
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return; // 非 JSON，丢弃
    }
    // 信任边界：转发前用 zod 校验（PLAN §2.1）。
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
