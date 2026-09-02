import type { SessionId, TurnId } from '@linkcode/schema';
import type { Unsubscribe } from '@linkcode/transport';

/** One `conversation.graph.changed` broadcast: the graph moved its default leaf or gained shape. */
export interface ConversationGraphChange {
  graphRevision: number;
  activeLeafTurnId?: TurnId;
}

type ChangeCb = (change: ConversationGraphChange) => void;

/**
 * Per-session register of the newest graph revision the daemon announced on this connection. Not
 * a buffer: a store holding a read at an older revision only needs to know that a newer one exists
 * and where its leaf is.
 */
export class ConversationGraphChanges {
  private readonly latest = new Map<SessionId, ConversationGraphChange>();
  private readonly subscribers = new Map<SessionId, Set<ChangeCb>>();

  note(sessionId: SessionId, change: ConversationGraphChange): void {
    const current = this.latest.get(sessionId);
    if (current !== undefined && current.graphRevision >= change.graphRevision) return;
    this.latest.set(sessionId, change);
    const subs = this.subscribers.get(sessionId);
    if (subs) for (const cb of subs) cb(change);
  }

  get(sessionId: SessionId): ConversationGraphChange | undefined {
    return this.latest.get(sessionId);
  }

  subscribe(sessionId: SessionId, cb: ChangeCb): Unsubscribe {
    let set = this.subscribers.get(sessionId);
    if (!set) {
      set = new Set();
      this.subscribers.set(sessionId, set);
    }
    set.add(cb);
    return () => set.delete(cb);
  }

  clearSession(sessionId: SessionId): void {
    this.latest.delete(sessionId);
    this.subscribers.delete(sessionId);
  }

  clearAll(): void {
    this.latest.clear();
    this.subscribers.clear();
  }
}
