import {
  TUNNEL_MAX_CONNECTION_AGE_MS,
  TunnelChunkAssembler,
  TunnelChunkEncoder,
} from '@linkcode/tunnel';
import { nullthrow } from 'foxts/guard';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../transport';
import { createWireMessage } from '../transport';
import { TunnelTransport, TunnelTransportServer } from '../tunnel';
import type { TunnelPeerFrame } from '../tunnel-peer-frame';
import { decodeTunnelPeerFrame, encodeTunnelPeerFrame } from '../tunnel-peer-frame';
import {
  TUNNEL_HOST_HANDOFF_ACK_FRAME,
  TUNNEL_HOST_HANDOFF_PREFIX,
  TUNNEL_HOST_PREPARED_FRAME,
  TUNNEL_HOST_READY_ACK_FRAME,
  TUNNEL_HOST_READY_FRAME,
  TUNNEL_HOST_ROTATE_PREFIX,
  TUNNEL_SUBPROTOCOL,
} from '../tunnel-protocol';

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = [];

  readonly OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  readonly sent: Array<string | ArrayBuffer> = [];
  readonly protocols: string | string[] | undefined;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(_url: string, protocols?: string | string[]) {
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(cb);
    this.listeners.set(type, listeners);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', { code: 1000 });
  }

  emit(type: string, event: unknown): void {
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

const FakeImpl = FakeWebSocket as unknown as typeof WebSocket;

function latestSocket(): FakeWebSocket {
  return nullthrow(FakeWebSocket.instances.at(-1), 'missing fake socket');
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
});

describe('TunnelTransportServer', () => {
  it('surfaces relay peers as directed transports', async () => {
    const server = new TunnelTransportServer({
      baseUrl: 'https://api.linkcode.ai',
      hostId: 'host-1',
      getToken: () => Promise.resolve('token'),
      WebSocketImpl: FakeImpl,
    });
    const connections: Transport[] = [];
    server.onConnection((connection) => connections.push(connection));

    const connecting = server.connect();
    await Promise.resolve();
    const socket = latestSocket();
    socket.readyState = socket.OPEN;
    socket.emit('open', {});
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.sent).toEqual([TUNNEL_HOST_READY_FRAME]);
    expect(server.connectionState).toBe('connecting');
    socket.emit('message', {
      data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
    });
    expect(connections).toEqual([]);
    socket.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
    socket.emit('message', {
      data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-2' }),
    });
    await connecting;
    expect(server.connectionState).toBe('open');
    expect(socket.protocols).toEqual([TUNNEL_SUBPROTOCOL]);

    const [connection, secondConnection] = connections;
    expect(connection).toBeDefined();
    expect(secondConnection).toBeDefined();

    const inbound: unknown[] = [];
    connection.onMessage((message) => inbound.push(message));
    const request = createWireMessage({ kind: 'session.list', clientReqId: 'r1' });
    for (const data of new TunnelChunkEncoder(1).encode(JSON.stringify(request))) {
      socket.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.data', peerId: 'peer-1', data }),
      });
    }
    expect(inbound).toEqual([request]);

    connection.send(createWireMessage({ kind: 'request.succeeded', replyTo: 'r1' }));
    let outbound: TunnelPeerFrame | null = null;
    for (const sent of socket.sent) {
      if (!(sent instanceof ArrayBuffer)) continue;
      const frame = decodeTunnelPeerFrame(sent);
      if (frame?.kind === 'peer.data') {
        outbound = frame;
        break;
      }
    }
    const assembler = new TunnelChunkAssembler();
    expect(outbound?.peerId).toBe('peer-1');
    expect(
      outbound?.kind === 'peer.data' && outbound.data instanceof ArrayBuffer
        ? JSON.parse(assembler.push(outbound.data) ?? 'null').payload
        : null,
    ).toMatchObject({ kind: 'request.succeeded', replyTo: 'r1' });

    let closed = 0;
    connection.onClose(() => closed++);
    socket.emit('message', {
      data: encodeTunnelPeerFrame({ kind: 'peer.leave', peerId: 'peer-1' }),
    });
    expect(closed).toBe(1);
    await server.close();
  });

  it('keeps a reconnecting host unavailable until the relay acknowledges it', async () => {
    vi.useFakeTimers();
    try {
      const server = new TunnelTransportServer({
        baseUrl: 'https://api.linkcode.ai',
        hostId: 'host-1',
        getToken: () => Promise.resolve('token'),
        WebSocketImpl: FakeImpl,
      });

      const connecting = server.connect();
      await Promise.resolve();
      const first = latestSocket();
      first.readyState = first.OPEN;
      first.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      first.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await connecting;

      first.emit('close', { code: 1006 });
      await Promise.resolve();
      await Promise.resolve();
      expect(server.connectionState).toBe('reconnecting');
      const second = latestSocket();
      second.readyState = second.OPEN;
      second.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      expect(second.sent).toEqual([TUNNEL_HOST_READY_FRAME]);
      expect(server.connectionState).toBe('reconnecting');

      second.readyState = 3;
      second.emit('close', { code: 1006 });
      await vi.advanceTimersByTimeAsync(1300);
      const third = latestSocket();
      expect(third).not.toBe(second);
      third.readyState = third.OPEN;
      third.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      third.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await vi.waitFor(() => expect(server.connectionState).toBe('open'));
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an error delivered immediately after host readiness', async () => {
    const server = new TunnelTransportServer({
      baseUrl: 'https://api.linkcode.ai',
      hostId: 'host-1',
      getToken: () => Promise.resolve('token'),
      WebSocketImpl: FakeImpl,
    });

    const connecting = server.connect();
    const rejected = expect(connecting).rejects.toThrow('connection error during handshake');
    await Promise.resolve();
    const socket = latestSocket();
    socket.readyState = socket.OPEN;
    socket.emit('open', {});
    await Promise.resolve();
    await Promise.resolve();
    socket.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
    socket.emit('error', {});

    await rejected;
    expect(socket.readyState).toBe(3);
    expect(server.connectionState).toBe('idle');
  });

  it('stops reconnecting when a replacement host is rejected while adopting readiness', async () => {
    vi.useFakeTimers();
    try {
      const server = new TunnelTransportServer({
        baseUrl: 'https://api.linkcode.ai',
        hostId: 'host-1',
        getToken: () => Promise.resolve('token'),
        WebSocketImpl: FakeImpl,
      });

      const connecting = server.connect();
      await Promise.resolve();
      const first = latestSocket();
      first.readyState = first.OPEN;
      first.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      first.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await connecting;

      first.emit('close', { code: 1006 });
      await Promise.resolve();
      await Promise.resolve();
      const replacement = latestSocket();
      replacement.readyState = replacement.OPEN;
      replacement.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      replacement.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      replacement.readyState = 3;
      replacement.emit('close', { code: 4001 });

      await vi.advanceTimersByTimeAsync(5000);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(server.connectionState).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends a client transport lifetime on a transient socket drop', async () => {
    const transport = new TunnelTransport({
      baseUrl: 'https://api.linkcode.ai',
      role: 'client',
      hostId: 'host-1',
      getToken: () => Promise.resolve('token'),
      WebSocketImpl: FakeImpl,
    });
    let closed = 0;
    transport.onClose(() => closed++);
    const connecting = transport.connect();
    await Promise.resolve();
    const socket = latestSocket();
    socket.readyState = socket.OPEN;
    socket.emit('open', {});
    await connecting;

    socket.emit('close', { code: 4008 });
    await Promise.resolve();

    expect(closed).toBe(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('hands a host peer over behind a barrier without duplicating or resetting its stream', async () => {
    vi.useFakeTimers();
    try {
      const server = new TunnelTransportServer({
        baseUrl: 'https://api.linkcode.ai',
        hostId: 'host-1',
        getToken: () => Promise.resolve('token'),
        WebSocketImpl: FakeImpl,
      });
      const connections: Transport[] = [];
      server.onConnection((connection) => connections.push(connection));
      const connecting = server.connect();
      await Promise.resolve();
      const oldSocket = latestSocket();
      oldSocket.readyState = oldSocket.OPEN;
      oldSocket.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      oldSocket.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await connecting;
      oldSocket.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
      });
      const connection = nullthrow(connections[0], 'missing peer transport');
      const inbound: unknown[] = [];
      connection.onMessage((message) => inbound.push(message));

      await vi.advanceTimersByTimeAsync(TUNNEL_MAX_CONNECTION_AGE_MS - 60 * 60 * 1000);
      const candidate = latestSocket();
      candidate.readyState = candidate.OPEN;
      candidate.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      const rotate = candidate.sent.find(
        (frame): frame is string =>
          typeof frame === 'string' && frame.startsWith(TUNNEL_HOST_ROTATE_PREFIX),
      );
      const token = nullthrow(rotate, 'missing rotate frame').slice(
        TUNNEL_HOST_ROTATE_PREFIX.length,
      );
      candidate.emit('message', { data: TUNNEL_HOST_PREPARED_FRAME });
      await Promise.resolve();
      await Promise.resolve();
      expect(oldSocket.sent).toContain(`${TUNNEL_HOST_HANDOFF_PREFIX}${token}`);

      const request = createWireMessage({ kind: 'session.list', clientReqId: 'handoff-request' });
      const chunks = new TunnelChunkEncoder(1).encode(JSON.stringify(request));
      oldSocket.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.data', peerId: 'peer-1', data: chunks[0] }),
      });
      candidate.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
      });
      for (const data of chunks.slice(1)) {
        candidate.emit('message', {
          data: encodeTunnelPeerFrame({ kind: 'peer.data', peerId: 'peer-1', data }),
        });
      }
      connection.send(createWireMessage({ kind: 'request.succeeded', replyTo: 'handoff-request' }));
      expect(oldSocket.sent.filter((frame) => frame instanceof ArrayBuffer)).toEqual([]);
      expect(candidate.sent.filter((frame) => frame instanceof ArrayBuffer)).toEqual([]);

      candidate.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      oldSocket.emit('message', { data: TUNNEL_HOST_HANDOFF_ACK_FRAME });
      oldSocket.close();
      expect(connections).toHaveLength(1);
      expect(inbound).toEqual([request]);
      await vi.waitFor(() => {
        let outbound = 0;
        for (const sent of candidate.sent) {
          if (!(sent instanceof ArrayBuffer)) continue;
          if (decodeTunnelPeerFrame(sent)?.kind === 'peer.data') outbound += 1;
        }
        expect(outbound).toBe(1);
      });
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a snapshotted peer when the predecessor ack is lost', async () => {
    vi.useFakeTimers();
    try {
      const server = new TunnelTransportServer({
        baseUrl: 'https://api.linkcode.ai',
        hostId: 'host-1',
        getToken: () => Promise.resolve('token'),
        WebSocketImpl: FakeImpl,
      });
      const connections: Transport[] = [];
      server.onConnection((connection) => connections.push(connection));
      const connecting = server.connect();
      await Promise.resolve();
      const oldSocket = latestSocket();
      oldSocket.readyState = oldSocket.OPEN;
      oldSocket.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      oldSocket.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await connecting;
      oldSocket.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
      });
      const connection = nullthrow(connections[0], 'missing peer transport');
      const inbound: unknown[] = [];
      let closed = 0;
      connection.onMessage((message) => inbound.push(message));
      connection.onClose(() => closed++);

      await vi.advanceTimersByTimeAsync(TUNNEL_MAX_CONNECTION_AGE_MS - 60 * 60 * 1000);
      const candidate = latestSocket();
      candidate.readyState = candidate.OPEN;
      candidate.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      candidate.emit('message', { data: TUNNEL_HOST_PREPARED_FRAME });
      await Promise.resolve();
      await Promise.resolve();

      const request = createWireMessage({ kind: 'session.list', clientReqId: 'after-handoff' });
      candidate.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
      });
      for (const data of new TunnelChunkEncoder(2).encode(JSON.stringify(request))) {
        candidate.emit('message', {
          data: encodeTunnelPeerFrame({ kind: 'peer.data', peerId: 'peer-1', data }),
        });
      }
      candidate.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      oldSocket.close();

      await vi.waitFor(() => expect(inbound).toEqual([request]));
      expect(closed).toBe(0);
      expect(connections).toHaveLength(1);
      expect(() =>
        connection.send(createWireMessage({ kind: 'request.succeeded', replyTo: 'after-handoff' })),
      ).not.toThrow();
      expect(candidate.sent.some((frame) => frame instanceof ArrayBuffer)).toBe(true);
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the old peer generation when a rotation has no matched predecessor', async () => {
    vi.useFakeTimers();
    try {
      const server = new TunnelTransportServer({
        baseUrl: 'https://api.linkcode.ai',
        hostId: 'host-1',
        getToken: () => Promise.resolve('token'),
        WebSocketImpl: FakeImpl,
      });
      const connections: Transport[] = [];
      server.onConnection((connection) => connections.push(connection));
      const connecting = server.connect();
      await Promise.resolve();
      const oldSocket = latestSocket();
      oldSocket.readyState = oldSocket.OPEN;
      oldSocket.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      oldSocket.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await connecting;
      oldSocket.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
      });
      const connection = nullthrow(connections[0], 'missing peer transport');
      let closed = 0;
      connection.onClose(() => closed++);

      await vi.advanceTimersByTimeAsync(TUNNEL_MAX_CONNECTION_AGE_MS - 60 * 60 * 1000);
      const candidate = latestSocket();
      candidate.readyState = candidate.OPEN;
      candidate.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      candidate.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await vi.waitFor(() => expect(closed).toBe(1));
      expect(connections).toHaveLength(1);
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the old peer generation when its predecessor dies during handoff', async () => {
    vi.useFakeTimers();
    try {
      const server = new TunnelTransportServer({
        baseUrl: 'https://api.linkcode.ai',
        hostId: 'host-1',
        getToken: () => Promise.resolve('token'),
        WebSocketImpl: FakeImpl,
      });
      const connections: Transport[] = [];
      server.onConnection((connection) => connections.push(connection));
      const connecting = server.connect();
      await Promise.resolve();
      const oldSocket = latestSocket();
      oldSocket.readyState = oldSocket.OPEN;
      oldSocket.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      oldSocket.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await connecting;
      oldSocket.emit('message', {
        data: encodeTunnelPeerFrame({ kind: 'peer.join', peerId: 'peer-1' }),
      });
      const connection = nullthrow(connections[0], 'missing peer transport');
      let closed = 0;
      connection.onClose(() => closed++);

      await vi.advanceTimersByTimeAsync(TUNNEL_MAX_CONNECTION_AGE_MS - 60 * 60 * 1000);
      const candidate = latestSocket();
      candidate.readyState = candidate.OPEN;
      candidate.emit('open', {});
      await Promise.resolve();
      await Promise.resolve();
      candidate.emit('message', { data: TUNNEL_HOST_PREPARED_FRAME });
      await Promise.resolve();
      await Promise.resolve();
      expect(oldSocket.sent).toContainEqual(expect.stringMatching(/^host\.handoff:/));

      oldSocket.close();
      candidate.emit('message', { data: TUNNEL_HOST_READY_ACK_FRAME });
      await vi.waitFor(() => expect(closed).toBe(1));
      expect(connections).toHaveLength(1);
      await server.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
