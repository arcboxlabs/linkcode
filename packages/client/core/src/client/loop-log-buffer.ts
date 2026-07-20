import type { LoopId, LoopLogEntry } from '@linkcode/schema';

/** Per-loop cap; a loop's log streams unbounded but only its recent tail is ever shown. */
const MAX_LOG_ENTRIES = 2000;

const EMPTY: readonly LoopLogEntry[] = Object.freeze([]);

/**
 * Client-side log buffer for loops. Folds the `loop.inspect` seed together with live `loop.log`
 * broadcasts, deduping and ordering by monotonic `seq` and capping at {@link MAX_LOG_ENTRIES} (oldest
 * dropped). Caches one immutable snapshot array per loop so `useSyncExternalStore` sees a stable
 * reference until the log actually changes.
 */
export class LoopLogBuffer {
  private readonly entries = new Map<LoopId, LoopLogEntry[]>();
  private readonly seen = new Map<LoopId, Set<number>>();
  private readonly snapshots = new Map<LoopId, readonly LoopLogEntry[]>();
  private readonly subs = new Map<LoopId, Set<() => void>>();

  /** Seed (or re-seed) a loop's log from an inspect snapshot, merging any live entries that raced it. */
  seed(loopId: LoopId, logs: LoopLogEntry[]): void {
    const seen = new Set<number>();
    const merged: LoopLogEntry[] = [];
    const add = (entry: LoopLogEntry): void => {
      if (seen.has(entry.seq)) return;
      seen.add(entry.seq);
      merged.push(entry);
    };
    for (const entry of logs) add(entry);
    for (const entry of this.entries.get(loopId) ?? []) add(entry);
    merged.sort((a, b) => a.seq - b.seq);
    this.commit(loopId, merged, seen);
  }

  /** Ingest one live `loop.log` line, deduped by `seq`. */
  ingest(loopId: LoopId, entry: LoopLogEntry): void {
    const seen = this.seen.get(loopId) ?? new Set<number>();
    if (seen.has(entry.seq)) return;
    seen.add(entry.seq);
    const list = this.entries.get(loopId) ?? [];
    list.push(entry);
    // Entries usually arrive in order; re-sort only on the rare out-of-order arrival.
    if (list.length > 1 && list[list.length - 2].seq > entry.seq) {
      list.sort((a, b) => a.seq - b.seq);
    }
    this.commit(loopId, list, seen);
  }

  /** Stable snapshot for `useSyncExternalStore`; identity changes only when the loop's log changes. */
  snapshot(loopId: LoopId): readonly LoopLogEntry[] {
    return this.snapshots.get(loopId) ?? EMPTY;
  }

  subscribe(loopId: LoopId, cb: () => void): () => void {
    let set = this.subs.get(loopId);
    if (!set) {
      set = new Set();
      this.subs.set(loopId, set);
    }
    set.add(cb);
    return () => {
      const current = this.subs.get(loopId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) this.subs.delete(loopId);
    };
  }

  /** Drop all buffered logs (e.g. on client dispose), notifying live subscribers to re-read. */
  clear(): void {
    this.entries.clear();
    this.seen.clear();
    this.snapshots.clear();
    for (const set of this.subs.values()) {
      for (const cb of set) cb();
    }
  }

  private commit(loopId: LoopId, list: LoopLogEntry[], seen: Set<number>): void {
    if (list.length > MAX_LOG_ENTRIES) {
      const dropped = list.splice(0, list.length - MAX_LOG_ENTRIES);
      for (const entry of dropped) seen.delete(entry.seq);
    }
    this.entries.set(loopId, list);
    this.seen.set(loopId, seen);
    this.snapshots.set(loopId, [...list]);
    const set = this.subs.get(loopId);
    if (set) {
      for (const cb of set) cb();
    }
  }
}
