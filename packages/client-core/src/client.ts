import type {
  AgentEvent,
  AgentInput,
  SessionId,
  StartOptions,
  WireMessage,
} from '@linkcode/schema';
import { type Transport, type Unsubscribe, createWireMessage } from '@linkcode/transport';

type EventCb = (event: AgentEvent) => void;

/**
 * LinkCodeClient: the data-plane client shared across all three platforms (PLAN §4.6).
 * It layers session semantics (start / send / subscribe to events / stop) on top of the transport,
 * staying agnostic to whether the underlying transport is LocalTransport or WsTransport (PLAN §2.6).
 */
export class LinkCodeClient {
  private readonly subscribers = new Map<SessionId, Set<EventCb>>();
  private readonly pendingStarts: Array<(id: SessionId) => void> = [];
  private unsub: Unsubscribe | null = null;

  constructor(private readonly transport: Transport) {}

  async connect(): Promise<void> {
    await this.transport.connect();
    this.unsub = this.transport.onMessage((msg) => this.route(msg));
  }

  private route(msg: WireMessage): void {
    const p = msg.payload;
    if (p.kind === 'session.started') {
      // FIFO pairing: resolve the earliest pending startSession.
      this.pendingStarts.shift()?.(p.sessionId);
    } else if (p.kind === 'agent.event') {
      const subs = this.subscribers.get(p.sessionId);
      if (subs) for (const cb of subs) cb(p.event);
    }
  }

  startSession(opts: StartOptions): Promise<SessionId> {
    return new Promise<SessionId>((resolve) => {
      this.pendingStarts.push(resolve);
      this.transport.send(createWireMessage({ kind: 'session.start', opts }));
    });
  }

  send(sessionId: SessionId, input: AgentInput): void {
    this.transport.send(createWireMessage({ kind: 'agent.input', sessionId, input }));
  }

  stopSession(sessionId: SessionId): void {
    this.transport.send(createWireMessage({ kind: 'session.stop', sessionId }));
    this.subscribers.delete(sessionId);
  }

  subscribe(sessionId: SessionId, cb: EventCb): Unsubscribe {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(cb);
    return () => set?.delete(cb);
  }

  dispose(): void {
    this.unsub?.();
    this.subscribers.clear();
    this.transport.close();
  }
}
