import type { AgentEvent, ConversationWatermark, RunId, SessionId, TurnId } from '@linkcode/schema';
import { compareConversationWatermarks } from '@linkcode/schema';

/** One stamped live event: what its `agent.event` envelope carried, positioned for the
 * lexicographic `(epoch, seq)` watermark merge. */
export interface JournaledEvent {
  readonly epoch: number;
  readonly seq: number;
  readonly runId: RunId;
  readonly turnId?: TurnId;
  readonly ts: number;
  readonly event: AgentEvent;
}

interface JournalEntry {
  readonly event: JournaledEvent;
  readonly bytes: number;
}

const DEFAULT_JOURNAL_BYTE_CAP = 10 * 1024 * 1024;
const DEFAULT_JOURNAL_EVENT_CAP = 10_000;

function stampOf(event: JournaledEvent): ConversationWatermark {
  return { epoch: event.epoch, seq: event.seq };
}

/**
 * Byte/event-bounded live tail of one session's stamped `agent.event` stream (the
 * `TerminalReplayJournal` pattern). Bounded is non-negotiable: an unthrottled chunk storm must
 * evict from the front, never grow — the 2026-08 daemon OOM came from an unbounded event corpus.
 */
export class ConversationLiveJournal {
  private readonly entries: JournalEntry[] = [];
  private byteCount = 0;
  /** First position ever appended: completeness is provable only for watermarks at or above its
   * predecessor — anything older (an earlier epoch's tail) never reached this journal. */
  private first: ConversationWatermark | undefined;
  /** Highest position evicted by the caps; a watermark below it lost events it never saw. */
  private evictedThrough: ConversationWatermark | undefined;
  private last: ConversationWatermark | undefined;

  constructor(
    private readonly maxBytes = DEFAULT_JOURNAL_BYTE_CAP,
    private readonly maxEvents = DEFAULT_JOURNAL_EVENT_CAP,
  ) {}

  get bytes(): number {
    return this.byteCount;
  }

  get size(): number {
    return this.entries.length;
  }

  get truncated(): boolean {
    return this.evictedThrough !== undefined;
  }

  /** Highest position appended — the merge watermark the final page of a read carries. */
  get watermark(): ConversationWatermark | undefined {
    return this.last;
  }

  snapshot(): JournaledEvent[] {
    return this.entries.map(({ event }) => event);
  }

  append(event: JournaledEvent): void {
    const stamp = stampOf(event);
    this.first ??= stamp;
    if (this.last === undefined || compareConversationWatermarks(stamp, this.last) > 0) {
      this.last = stamp;
    }
    const bytes = Buffer.byteLength(JSON.stringify(event.event));
    this.entries.push({ event, bytes });
    this.byteCount += bytes;
    while (
      (this.byteCount > this.maxBytes || this.entries.length > this.maxEvents) &&
      this.entries.length > 0
    ) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.byteCount -= removed.bytes;
      const evicted = stampOf(removed.event);
      if (
        this.evictedThrough === undefined ||
        compareConversationWatermarks(evicted, this.evictedThrough) > 0
      ) {
        this.evictedThrough = evicted;
      }
    }
  }

  /**
   * Retained events above `watermark`, and whether that set is provably complete. `gap` means
   * events past the watermark were evicted or never reached this journal (an older epoch's tail):
   * the reader must clear the affected in-flight state and re-read — never splice a headless tail.
   * A watermark ABOVE everything appended is also a gap: an honest current client compares at
   * most equal, so above means epoch reuse or a foreign watermark, never provable completeness.
   * Events return in append order, not stamp order (a stale straggler can sit after newer-epoch
   * entries); consumers merge by stamp.
   */
  tailAfter(watermark: ConversationWatermark): { events: JournaledEvent[]; gap: boolean } {
    const gap =
      this.last === undefined ||
      compareConversationWatermarks(watermark, this.last) > 0 ||
      (this.evictedThrough !== undefined &&
        compareConversationWatermarks(this.evictedThrough, watermark) > 0) ||
      (this.first !== undefined &&
        compareConversationWatermarks(watermark, {
          epoch: this.first.epoch,
          seq: this.first.seq - 1,
        }) < 0);
    const events: JournaledEvent[] = [];
    for (let i = 0, len = this.entries.length; i < len; i++) {
      const { event } = this.entries[i];
      if (compareConversationWatermarks(stampOf(event), watermark) > 0) events.push(event);
    }
    return { events, gap };
  }
}

/** Per-session live journals, created on the first stamped broadcast and dropped with the live
 * session — total memory bounds to concurrent live adapters × the per-journal caps. */
export class ConversationLiveJournals {
  private readonly journals = new Map<SessionId, ConversationLiveJournal>();

  constructor(
    private readonly maxBytes?: number,
    private readonly maxEvents?: number,
  ) {}

  open(sessionId: SessionId): ConversationLiveJournal {
    const existing = this.journals.get(sessionId);
    if (existing) return existing;
    const journal = new ConversationLiveJournal(this.maxBytes, this.maxEvents);
    this.journals.set(sessionId, journal);
    return journal;
  }

  get(sessionId: SessionId): ConversationLiveJournal | undefined {
    return this.journals.get(sessionId);
  }

  drop(sessionId: SessionId): void {
    this.journals.delete(sessionId);
  }
}
