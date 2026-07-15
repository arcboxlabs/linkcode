import {
  TUNNEL_MAX_CONNECTION_AGE_MS,
  TUNNEL_PING_FRAME,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PONG_FRAME,
  TunnelChunkAssembler,
  TunnelChunkEncoder,
  TunnelCloseCode,
} from '@linkcode/tunnel';
import { never } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { Listeners } from './transport';
import type { TunnelPeer } from './tunnel-peer';
import { PeerConnection } from './tunnel-peer';
import { decodeTunnelPeerFrame, encodeTunnelPeerFrame } from './tunnel-peer-frame';
import {
  TUNNEL_HOST_HANDOFF_ACK_FRAME,
  TUNNEL_HOST_HANDOFF_PREFIX,
  TUNNEL_HOST_PREPARED_FRAME,
  TUNNEL_HOST_READY_ACK_FRAME,
} from './tunnel-protocol';
import type { PreparedTunnelSocket, TunnelSocketOptions } from './tunnel-socket';
import {
  dialTunnelSocket,
  prepareTunnelSocket,
  rotationToken,
  TunnelAuthError,
  TunnelSocketCloseError,
  waitForHandoffDrain,
  withTunnelTimeout,
} from './tunnel-socket';

export type { TunnelPeer } from './tunnel-peer';

export type TunnelClientState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type TunnelClientOptions = TunnelSocketOptions;

const TERMINAL_CLOSE_CODES = new Set<number>([
  1000,
  TunnelCloseCode.BadHandshake,
  TunnelCloseCode.Replaced,
  TunnelCloseCode.HostGone,
  TunnelCloseCode.HostNotFound,
  TunnelCloseCode.TooManyConnections,
]);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const ROTATE_AFTER_MS = TUNNEL_MAX_CONNECTION_AGE_MS - 60 * 60 * 1000;
/**
 * Reconnecting client for the tunnel v2 relay. Client-role callers use
 * send/onMessage; host-role callers receive one directed channel per peer.
 *
 * ponytail: remove this local seam once the published package includes v2.
 */
export class TunnelClient {
  private readonly inbound = new Listeners<string>();
  private readonly closed = new Listeners<void>();
  private readonly stateChanged = new Listeners<TunnelClientState>();
  private readonly peerJoined = new Listeners<TunnelPeer>();
  private readonly encoder = new TunnelChunkEncoder();
  private readonly assembler = new TunnelChunkAssembler();
  private readonly peers = new Map<string, PeerConnection>();
  private ws: WebSocket | null = null;
  /** Open replacement waiting for the relay's ready acknowledgment. */
  private candidateWs: WebSocket | null = null;
  /** Encoded host replies frozen behind the old socket's handoff barrier. */
  private handoffQueue: ArrayBuffer[] | null = null;
  private currentState: TunnelClientState = 'idle';
  private closedByUser = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: TunnelClientOptions) {}

  get state(): TunnelClientState {
    return this.currentState;
  }

  async connect(): Promise<void> {
    if (this.currentState !== 'idle') {
      throw new Error(`TunnelClient: connect() while ${this.currentState}`);
    }
    this.setState('connecting');
    try {
      const [ws, prepared] = await this.dialPrepared();
      if (this.closedByUser) {
        prepared.release();
        this.discardCandidate(ws);
        throw new Error('TunnelClient: closed during handshake');
      }
      this.adopt(ws, prepared);
      this.setState('open');
    } catch (err) {
      if (!this.closedByUser) this.setState('idle');
      throw err;
    }
  }

  send(message: string): void {
    if (this.opts.role === 'host') {
      throw new Error('TunnelClient: host messages must be sent through a peer');
    }
    const ws = this.openSocket();
    for (const frame of this.encoder.encode(message)) ws.send(frame);
  }

  onMessage(cb: (message: string) => void): () => void {
    return this.inbound.add(cb);
  }

  onPeer(cb: (peer: TunnelPeer) => void): () => void {
    const unsubscribe = this.peerJoined.add(cb);
    for (const peer of this.peers.values()) cb(peer);
    return unsubscribe;
  }

  onClose(cb: () => void): () => void {
    return this.closed.add(cb);
  }

  onStateChange(cb: (state: TunnelClientState) => void): () => void {
    return this.stateChanged.add(cb);
  }

  close(): void {
    this.closedByUser = true;
    this.stopTimers();
    const ws = this.ws;
    const candidate = this.candidateWs;
    this.ws = null;
    this.candidateWs = null;
    this.handoffQueue = null;
    ws?.close(1000);
    if (candidate !== ws) candidate?.close(1000);
    this.finalize();
  }

  private adopt(ws: WebSocket, prepared: PreparedTunnelSocket): void {
    if (ws.readyState !== ws.OPEN) {
      const failure = prepared.release();
      if (this.candidateWs === ws) this.candidateWs = null;
      throw failure ?? new Error('TunnelClient: socket closed during handshake');
    }
    this.stopTimers();
    this.assembler.reset();
    this.ws = ws;
    ws.addEventListener('message', (event: MessageEvent) => this.handleMessage(ws, event));
    ws.addEventListener('close', (event: CloseEvent) => this.handleClose(ws, event), {
      once: true,
    });
    const failure = prepared.release();
    if (failure) {
      if (this.ws === ws) this.ws = null;
      this.discardCandidate(ws);
      throw failure;
    }
    if (this.candidateWs === ws) this.candidateWs = null;
    for (const event of prepared.buffered) this.handleMessage(ws, event);
    if (this.closedByUser || ws !== this.ws) {
      throw new Error('TunnelClient: socket closed during handshake');
    }
    this.pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(TUNNEL_PING_FRAME);
    }, TUNNEL_PING_INTERVAL_MS);
    if (this.opts.role === 'host') {
      this.rotateTimer = setTimeout(() => {
        this.rotate().catch(noop);
      }, ROTATE_AFTER_MS);
    }
  }

  private handleMessage(ws: WebSocket, event: MessageEvent): void {
    if (ws !== this.ws) return;
    const data: unknown = event.data;
    if (typeof data === 'string') {
      if (
        data === TUNNEL_PONG_FRAME ||
        data === TUNNEL_PING_FRAME ||
        data === TUNNEL_HOST_READY_ACK_FRAME ||
        data === TUNNEL_HOST_PREPARED_FRAME ||
        data === TUNNEL_HOST_HANDOFF_ACK_FRAME
      ) {
        return;
      }
      this.inbound.emit(data);
    } else if (data instanceof ArrayBuffer && this.opts.role === 'host') {
      const frame = decodeTunnelPeerFrame(data);
      if (!frame) return;
      switch (frame.kind) {
        case 'peer.join':
          this.joinPeer(frame.peerId);
          break;
        case 'peer.leave':
          this.leavePeer(frame.peerId);
          break;
        case 'peer.data':
          if (!this.peers.has(frame.peerId)) this.joinPeer(frame.peerId);
          this.peers.get(frame.peerId)?.receive(frame.data);
          break;
        default:
          never(frame, 'tunnel peer frame');
      }
    } else if (data instanceof ArrayBuffer) {
      const message = this.assembler.push(data);
      if (message !== null) this.inbound.emit(message);
    }
  }

  private handleClose(ws: WebSocket, event: CloseEvent): void {
    if (ws !== this.ws) return;
    this.stopTimers();
    this.ws = null;
    this.assembler.reset();
    if (this.candidateWs && this.candidateWs !== ws) return;
    this.closePeers();
    if (this.closedByUser || this.opts.role === 'client' || TERMINAL_CLOSE_CODES.has(event.code)) {
      this.finalize();
    } else {
      void this.reconnectLoop();
    }
  }

  private async reconnectLoop(): Promise<void> {
    this.setState('reconnecting');
    for (let attempt = 0; !this.closedByUser; attempt++) {
      try {
        const [ws, prepared] = await this.dialPrepared();
        if (this.closedByUser) {
          prepared.release();
          this.discardCandidate(ws);
          return;
        }
        this.adopt(ws, prepared);
        this.setState('open');
        return;
      } catch (err) {
        if (
          err instanceof TunnelAuthError ||
          (err instanceof TunnelSocketCloseError && TERMINAL_CLOSE_CODES.has(err.code))
        ) {
          this.finalize();
          return;
        }
      }
      const backoff = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, backoff * (0.8 + Math.random() * 0.4));
      });
    }
  }

  private async rotate(): Promise<void> {
    const current = this.ws;
    if (!current || this.closedByUser) return;
    let handoffStarted = false;
    try {
      const token = rotationToken();
      const [ws, prepared] = await this.dialPrepared(token);
      if ((this.ws !== current && this.ws !== null) || this.closedByUser) {
        prepared.active.catch(noop);
        this.discardCandidate(ws);
        return;
      }
      if (prepared.status === 'prepared') {
        this.handoffQueue = [];
        handoffStarted = true;
        const drained = waitForHandoffDrain(current);
        current.send(`${TUNNEL_HOST_HANDOFF_PREFIX}${token}`);
        const [, predecessorAcknowledged] = await Promise.all([
          withTunnelTimeout(prepared.active, 'TunnelClient: replacement activation timed out'),
          drained,
        ]);
        if (!predecessorAcknowledged) this.reconcilePeers(prepared.buffered);
      } else {
        // No token-matched predecessor survived. The relay closes its client generation instead of
        // handing it over, so the host must close the matching virtual peers before adopting this socket.
        this.closePeers();
      }
      this.adopt(ws, prepared);
      const queued = this.handoffQueue;
      this.handoffQueue = null;
      if (queued) for (const frame of queued) ws.send(frame);
      if (current !== ws && current.readyState === current.OPEN) current.close(1000);
    } catch {
      if (handoffStarted) this.abortHandoff(current);
      else if (!this.ws && !this.closedByUser) void this.reconnectLoop();
    }
  }

  private sendToPeer(peerId: string, message: string): void {
    if (!this.peers.has(peerId)) throw new Error('TunnelPeer: connection closed');
    const ws = this.handoffQueue ? null : this.openSocket();
    for (const data of this.encoder.encode(message)) {
      const frame = encodeTunnelPeerFrame({ kind: 'peer.data', peerId, data });
      if (this.handoffQueue) this.handoffQueue.push(frame);
      else ws?.send(frame);
    }
  }

  private async dialPrepared(
    rotation?: string,
  ): Promise<readonly [WebSocket, PreparedTunnelSocket]> {
    const ws = await dialTunnelSocket(this.opts);
    if (this.closedByUser) {
      ws.close(1000);
      throw new Error('TunnelClient: closed during handshake');
    }
    this.candidateWs = ws;
    try {
      const prepared = await prepareTunnelSocket(ws, this.opts.role, rotation);
      if (rotation === undefined && prepared.status !== 'active') {
        throw new Error('TunnelClient: unexpected host handshake');
      }
      if (ws.readyState !== ws.OPEN) {
        throw prepared.release() ?? new Error('TunnelClient: socket closed during handshake');
      }
      return [ws, prepared];
    } catch (error) {
      if (this.candidateWs === ws) this.candidateWs = null;
      ws.close(1000);
      throw error;
    }
  }

  private discardCandidate(ws: WebSocket): void {
    if (this.candidateWs === ws) this.candidateWs = null;
    ws.close(1000);
  }

  private abortHandoff(current: WebSocket): void {
    const candidate = this.candidateWs;
    this.stopTimers();
    this.ws = null;
    this.candidateWs = null;
    this.handoffQueue = null;
    current.close(1011, 'tunnel handoff failed');
    if (candidate !== current) candidate?.close(1011, 'tunnel handoff failed');
    this.closePeers();
    if (!this.closedByUser) void this.reconnectLoop();
  }

  private joinPeer(peerId: string): void {
    if (this.peers.has(peerId)) return;
    const peer = new PeerConnection(peerId, (id, message) => this.sendToPeer(id, message));
    this.peers.set(peerId, peer);
    this.peerJoined.emit(peer);
  }

  private leavePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.close();
  }

  private closePeers(): void {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
  }

  private reconcilePeers(buffered: readonly MessageEvent[]): void {
    const successorPeers = new Set<string>();
    for (const event of buffered) {
      if (!(event.data instanceof ArrayBuffer)) continue;
      const frame = decodeTunnelPeerFrame(event.data);
      if (frame?.kind === 'peer.join') successorPeers.add(frame.peerId);
    }
    for (const [peerId, peer] of this.peers) {
      if (successorPeers.has(peerId)) continue;
      this.peers.delete(peerId);
      peer.close();
    }
  }

  private openSocket(): WebSocket {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) throw new Error('TunnelClient: socket not open');
    return ws;
  }

  private stopTimers(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    if (this.rotateTimer !== null) clearTimeout(this.rotateTimer);
    this.pingTimer = null;
    this.rotateTimer = null;
  }

  private finalize(): void {
    if (this.currentState === 'closed') return;
    this.setState('closed');
    this.closePeers();
    this.inbound.clear();
    this.peerJoined.clear();
    this.closed.emit();
  }

  private setState(state: TunnelClientState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.stateChanged.emit(state);
  }
}
