import type {
  LoopId,
  LoopIteration,
  LoopLogEntry,
  LoopLogLevel,
  LoopLogSource,
  LoopRecord,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { RingBuffer } from './ring-buffer';

const LOG_RING_CAPACITY = 500;
const LOG_LINE_MAX_CHARS = 2000;

/** Owns the ephemeral loop log and projects loop state changes onto the wire. */
export class LoopReporter {
  private readonly logs = new Map<LoopId, RingBuffer<LoopLogEntry>>();
  private readonly logSeq = new Map<LoopId, number>();

  constructor(
    private readonly transport: Transport,
    private readonly now: () => number,
  ) {}

  start(loopId: LoopId): void {
    this.logs.set(loopId, new RingBuffer<LoopLogEntry>(LOG_RING_CAPACITY));
    this.logSeq.delete(loopId);
  }

  remove(loopId: LoopId): void {
    this.logs.delete(loopId);
    this.logSeq.delete(loopId);
    this.transport.send(createWireMessage({ kind: 'loop.removed', loopId }));
  }

  snapshot(loopId: LoopId): LoopLogEntry[] {
    return this.logs.get(loopId)?.snapshot() ?? [];
  }

  changed(loop: LoopRecord): void {
    this.transport.send(createWireMessage({ kind: 'loop.changed', loop }));
  }

  iteration(iteration: LoopIteration): void {
    this.transport.send(createWireMessage({ kind: 'loop.iteration', iteration }));
  }

  log(
    loopId: LoopId,
    level: LoopLogLevel,
    source: LoopLogSource,
    message: string,
    iteration?: number,
  ): void {
    const seq = this.logSeq.get(loopId) ?? 0;
    this.logSeq.set(loopId, seq + 1);
    const entry: LoopLogEntry = {
      seq,
      ts: this.now(),
      level,
      source,
      message: truncate(message),
      iteration,
    };
    let ring = this.logs.get(loopId);
    if (!ring) {
      ring = new RingBuffer<LoopLogEntry>(LOG_RING_CAPACITY);
      this.logs.set(loopId, ring);
    }
    ring.push(entry);
    this.transport.send(createWireMessage({ kind: 'loop.log', loopId, entry }));
  }
}

function truncate(text: string): string {
  return text.length > LOG_LINE_MAX_CHARS ? text.slice(0, LOG_LINE_MAX_CHARS) : text;
}
