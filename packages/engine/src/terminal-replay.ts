import type { TerminalReplayEvent } from '@linkcode/schema';

interface ReplayEntry {
  event: TerminalReplayEvent;
  bytes: number;
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
