import type { AgentEvent, SessionId } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';

/**
 * An event paired with its connection-scoped receive sequence number: the Nth `agent.event` this
 * client received for its session (1-based, monotone for the lifetime of the connection). A
 * transcript snapshot taken when the counter read N supersedes exactly the events with seq ≤ N.
 */
export interface SequencedAgentEvent {
  event: AgentEvent;
  seq: number;
  /** Client receive time (ms epoch), stamped when the event is ingested from the live stream.
   * Drives relative timestamps in the UI; absent for events replayed from a history read. */
  receivedAt?: number;
}

type EventCb = (event: AgentEvent, seq: number) => void;

const EMPTY_EVENTS: readonly SequencedAgentEvent[] = [];

/**
 * Per-session buffer of received `agent.event`s, their receive sequence numbers, and the
 * subscribers replaying/watching them. Backs both the push-model `subscribe` callback and the
 * `useSyncExternalStore`-shaped `snapshot`/`eventSeq` pair.
 */
export class EventBuffer {
  private readonly subscribers = new Map<SessionId, Set<EventCb>>();
  /** Per-session event buffer so a re-subscribe (switching the active session back) can replay the timeline. */
  private readonly events = new Map<SessionId, SequencedAgentEvent[]>();
  /** Cached immutable copies of {@link events}, invalidated per event — `snapshot`'s source. */
  private readonly snapshots = new Map<SessionId, readonly SequencedAgentEvent[]>();
  /** Per-session receive counters. Deliberately NOT cleared with the buffer on `clearSession`: a
   * stop→resume in the same connection must keep seq monotone, or a seed's `uptoSeq` sampled
   * before the stop would swallow the resumed session's fresh events. */
  private readonly seqs = new Map<SessionId, number>();

  /** Record an incoming event, assigning it the session's next receive sequence number. */
  ingest(sessionId: SessionId, event: AgentEvent): SequencedAgentEvent {
    const seq = (this.seqs.get(sessionId) ?? 0) + 1;
    this.seqs.set(sessionId, seq);
    const sequenced: SequencedAgentEvent = { event, seq, receivedAt: Date.now() };
    const buf = this.events.get(sessionId);
    if (buf) buf.push(sequenced);
    else this.events.set(sessionId, [sequenced]);
    this.snapshots.delete(sessionId);
    const subs = this.subscribers.get(sessionId);
    if (subs) for (const cb of subs) cb(sequenced.event, sequenced.seq);
    return sequenced;
  }

  subscribe(sessionId: SessionId, cb: EventCb): Unsubscribe {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(cb);
    // Replay any buffered events (with their original sequence numbers) so a late subscriber sees
    // the full timeline, not a blank pane.
    const buf = this.events.get(sessionId);
    if (buf) for (const { event, seq } of buf) cb(event, seq);
    return () => set.delete(cb);
  }

  /**
   * The receive counter for a session: how many `agent.event`s this client has seen for it on this
   * connection. Sampled right after a transcript read resolves, it becomes that snapshot's
   * `uptoSeq` — the ordered cut "everything at or before this is already in the snapshot".
   */
  eventSeq(sessionId: SessionId): number {
    return this.seqs.get(sessionId) ?? 0;
  }

  /**
   * Immutable snapshot of a session's buffered events, cached until the next event arrives.
   * Stable identity between changes makes it a valid `useSyncExternalStore` getSnapshot source.
   */
  snapshot(sessionId: SessionId): readonly SequencedAgentEvent[] {
    const cached = this.snapshots.get(sessionId);
    if (cached) return cached;
    const buf = this.events.get(sessionId);
    if (!buf || buf.length === 0) return EMPTY_EVENTS;
    const snapshot: readonly SequencedAgentEvent[] = [...buf];
    this.snapshots.set(sessionId, snapshot);
    return snapshot;
  }

  /** Drop a stopped session's subscribers and buffer, keeping its receive counter (see {@link seqs}). */
  clearSession(sessionId: SessionId): void {
    this.subscribers.delete(sessionId);
    this.events.delete(sessionId);
    this.snapshots.delete(sessionId);
  }

  clearAll(): void {
    this.subscribers.clear();
    this.events.clear();
    this.snapshots.clear();
    this.seqs.clear();
  }
}
