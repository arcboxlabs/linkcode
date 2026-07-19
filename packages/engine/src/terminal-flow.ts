import type { TerminalReplayEvent } from '@linkcode/schema';
import type { TerminalReplayJournal } from './terminal-replay';

/**
 * Per-terminal output flow control (CODE-231): the journal is the only buffer, a single cursor
 * delivers it in order, and delivery is clamped to the slowest attachment's unacknowledged
 * window. Consumed journal bytes are returned to the PTY backend as read credit, which is what
 * ultimately blocks a flooding process inside the kernel instead of ballooning any queue.
 *
 * Chars vs bytes: clients acknowledge UTF-16 lengths of the `data` strings they ingest (what
 * they can count), while PTY credits are raw bytes. The journal records each write's UTF-8 size,
 * which matches the sidecar's raw byte count (the streaming decoder's carry skews it by ≤3 bytes,
 * self-correcting on the next chunk), so consumption is mapped event-by-event, exactly.
 */

/** Max unacknowledged chars in flight per attachment; the slowest attachment gates delivery. */
export const TERMINAL_CLIENT_WINDOW_CHARS = 512 * 1024;
/** PTY read budget: initial credit at open, topped up as delivered bytes are consumed. */
export const TERMINAL_SIDECAR_WINDOW_BYTES = 1024 * 1024;

/** Clear screen + scrollback + home: substitutes a journal-truncation gap so the stream stays
 * renderable — the viewer loses the dropped scrollback but never sees a torn escape sequence
 * from mid-stream resumption without it. */
const GAP_CLEAR = '\u001B[2J\u001B[3J\u001B[H';

interface AttachmentFlow {
  /** `deliveredChars` at attach-reply time; this attachment only accounts for chars after it. */
  baseChars: number;
  /** Cumulative chars the client acknowledged since its baseline. */
  ackedChars: number;
}

export interface TerminalFlowDelegate {
  /** Send one journal event to the wire; write data may carry a gap-recovery clear prefix. */
  deliver(event: TerminalReplayEvent): void;
  /** Return consumed journal bytes to the PTY as read credit. */
  grantRead(bytes: number): void;
}

/** Delivered-but-unconsumed write events, in order: cumulative delivered-char end + journal bytes. */
interface UnconsumedEvent {
  endChars: number;
  bytes: number;
}

export class TerminalFlow {
  private cursorSeq: number;
  private deliveredChars = 0;
  private consumedChars = 0;
  private pendingGapClear = false;
  private readonly attachments = new Map<string, AttachmentFlow>();
  private readonly unconsumed: UnconsumedEvent[] = [];

  constructor(
    private readonly journal: TerminalReplayJournal,
    private readonly delegate: TerminalFlowDelegate,
    private readonly windowChars = TERMINAL_CLIENT_WINDOW_CHARS,
  ) {
    // Everything already in the journal (the spawn resize) belongs to attach snapshots, not the
    // live stream; the cursor starts at the current head.
    this.cursorSeq = journal.cutoffSeq;
  }

  /** True once every retained journal event has been delivered. */
  get drained(): boolean {
    return this.journal.entryAfter(this.cursorSeq) === undefined;
  }

  /** Register an attachment and return its snapshot: the journal up to the cursor. Later events
   * reach it as live frames, so snapshot + stream is complete and never overlaps its accounting.
   * A re-attach of a known attachment (a view→control upgrade) keeps its accounting epoch — the
   * client's cumulative ack counter spans its whole attachment lifetime, not the last upgrade. */
  attach(attachmentId: string): { replay: TerminalReplayEvent[]; cutoffSeq: number } {
    if (!this.attachments.has(attachmentId)) {
      this.attachments.set(attachmentId, { baseChars: this.deliveredChars, ackedChars: 0 });
    }
    return { replay: this.journal.snapshotUpTo(this.cursorSeq), cutoffSeq: this.cursorSeq };
  }

  detach(attachmentId: string): void {
    if (!this.attachments.delete(attachmentId)) return;
    this.advanceConsumption();
    this.pump();
  }

  /** Apply a client's cumulative ack. Clamped to what was actually delivered to it, so a hostile
   * or confused client cannot inflate credits. Stale (non-increasing) acks are ignored. */
  ack(attachmentId: string, ackedChars: number): void {
    const attachment = this.attachments.get(attachmentId);
    if (!attachment) return;
    const clamped = Math.min(ackedChars, this.deliveredChars - attachment.baseChars);
    if (clamped <= attachment.ackedChars) return;
    attachment.ackedChars = clamped;
    this.advanceConsumption();
    this.pump();
  }

  /** Deliver journal events while the slowest attachment's window has room. Call after every
   * journal append and whenever a window may have moved (ack/detach). */
  pump(): void {
    while (this.maxOutstanding() < this.windowChars) {
      const step = this.journal.entryAfter(this.cursorSeq);
      if (!step) return;
      this.cursorSeq = step.event.seq;
      if (step.gap) this.pendingGapClear = true;
      if (step.event.type === 'write') {
        const data = this.pendingGapClear ? GAP_CLEAR + step.event.data : step.event.data;
        this.pendingGapClear = false;
        this.deliveredChars += data.length;
        this.unconsumed.push({ endChars: this.deliveredChars, bytes: step.bytes });
        this.delegate.deliver({ ...step.event, data });
      } else {
        this.delegate.deliver(step.event);
      }
      this.advanceConsumption();
    }
  }

  /** Slowest attachment's delivered-but-unacked chars; zero when unattached (free-running). */
  private maxOutstanding(): number {
    let slowest = this.deliveredChars;
    for (const { baseChars, ackedChars } of this.attachments.values()) {
      slowest = Math.min(slowest, baseChars + ackedChars);
    }
    return this.deliveredChars - slowest;
  }

  /** Advance the consumption watermark to the slowest attachment (or the cursor when unattached)
   * and return the freed journal bytes to the PTY as credit. Whole events only — partial-event
   * grants would drift the byte mapping. */
  private advanceConsumption(): void {
    const target = this.deliveredChars - this.maxOutstanding();
    if (target <= this.consumedChars) return;
    this.consumedChars = target;
    let freed = 0;
    while (this.unconsumed.length > 0 && this.unconsumed[0].endChars <= target) {
      const event = this.unconsumed.shift();
      if (!event) break;
      freed += event.bytes;
    }
    if (freed > 0) this.delegate.grantRead(freed);
  }
}
