import type { TerminalReplayEvent } from '@linkcode/schema';

interface ReplayEntry {
  event: TerminalReplayEvent;
  bytes: number;
}

/** One journal step for a delivery cursor (see {@link TerminalReplayJournal.entryAfter}). */
export interface ReplayStep {
  event: TerminalReplayEvent;
  /** UTF-8 byte size the journal accounted for this event. */
  bytes: number;
  /** True when events between the cursor and this one were truncated away (cap overflow). */
  gap: boolean;
}

const DEFAULT_REPLAY_CAP = 10 * 1024 * 1024;
const DEFAULT_REPLAY_EVENT_CAP = 10000;
const RESIZE_BYTES = 16;
const textEncoder = new TextEncoder();

/** Ordered, byte/event-bounded terminal input journal with one monotonic sequence. */
export class TerminalReplayJournal {
  private readonly entries: ReplayEntry[] = [];
  private bytes = 0;
  private seq = 0;
  private didTruncate = false;

  constructor(
    private readonly maxBytes = DEFAULT_REPLAY_CAP,
    private readonly maxEvents = DEFAULT_REPLAY_EVENT_CAP,
  ) {}

  get cutoffSeq(): number {
    return this.seq;
  }

  get truncated(): boolean {
    return this.didTruncate;
  }

  snapshot(): TerminalReplayEvent[] {
    return this.entries.map(({ event }) => event);
  }

  /** Retained events with seq ≤ `seq` — the attach snapshot for a delivery cursor at `seq`;
   * everything after it reaches that attachment as ordinary live frames. */
  snapshotUpTo(seq: number): TerminalReplayEvent[] {
    const events: TerminalReplayEvent[] = [];
    for (const { event } of this.entries) {
      if (event.seq > seq) break;
      events.push(event);
    }
    return events;
  }

  /** The first retained event after `seq`, or undefined when the cursor is at the head. O(1):
   * seqs are contiguous, so the target sits at a computable index. `gap` means the cap dropped
   * events between the cursor and the returned entry (only reachable with an unthrottled feed). */
  entryAfter(seq: number): ReplayStep | undefined {
    const first = this.entries[0];
    if (!first) return undefined;
    if (seq + 1 < first.event.seq) return { ...first, gap: true };
    const entry = this.entries[seq + 1 - first.event.seq];
    return entry ? { ...entry, gap: false } : undefined;
  }

  appendWrite(data: string): Extract<TerminalReplayEvent, { type: 'write' }> {
    const event = { type: 'write', seq: ++this.seq, data } as const;
    this.append(event, textEncoder.encode(data).byteLength);
    return event;
  }

  appendResize(cols: number, rows: number): Extract<TerminalReplayEvent, { type: 'resize' }> {
    const event = { type: 'resize', seq: ++this.seq, cols, rows } as const;
    this.append(event, RESIZE_BYTES);
    return event;
  }

  private append(event: TerminalReplayEvent, bytes: number): void {
    this.entries.push({ event, bytes });
    this.bytes += bytes;
    while (
      (this.bytes > this.maxBytes || this.entries.length > this.maxEvents) &&
      this.entries.length > 0
    ) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
      this.didTruncate = true;
    }
  }
}
