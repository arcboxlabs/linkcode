import type { TerminalReplayEvent } from '@linkcode/schema';

export type TerminalRendererEvent = ['w', string] | ['r', number, number];
export type TerminalRendererEventBatch = TerminalRendererEvent[];

const MAX_BATCH_BYTES = 64 * 1024;
const MAX_BATCH_EVENTS = 128;
const MAX_WRITE_CHUNK_CODE_UNITS = 8 * 1024;

/** Convert replay events into bridge-safe batches without splitting UTF-16 surrogate pairs. */
export function batchTerminalEvents(
  events: readonly TerminalReplayEvent[],
): TerminalRendererEventBatch[] {
  const batches: TerminalRendererEventBatch[] = [];
  let batch: TerminalRendererEventBatch = [];
  let batchBytes = 2;

  const flush = () => {
    if (batch.length === 0) return;
    batches.push(batch);
    batch = [];
    batchBytes = 2;
  };

  const append = (event: TerminalRendererEvent) => {
    const eventBytes = utf8ByteLength(JSON.stringify(event));
    if (eventBytes + 2 > MAX_BATCH_BYTES) {
      throw new RangeError('Terminal renderer event exceeds the bridge batch limit');
    }

    const separatorBytes = batch.length === 0 ? 0 : 1;
    if (
      batch.length === MAX_BATCH_EVENTS ||
      batchBytes + separatorBytes + eventBytes > MAX_BATCH_BYTES
    ) {
      flush();
    }

    batch.push(event);
    batchBytes += (batch.length === 1 ? 0 : 1) + eventBytes;
  };

  for (const event of events) {
    if (event.type === 'resize') {
      append(['r', event.cols, event.rows]);
      continue;
    }

    for (const chunk of splitWrite(event.data)) append(['w', chunk]);
  }

  flush();
  return batches;
}

function* splitWrite(data: string): Generator<string> {
  if (data.length === 0) {
    yield '';
    return;
  }

  let start = 0;
  while (start < data.length) {
    let end = Math.min(start + MAX_WRITE_CHUNK_CODE_UNITS, data.length);
    if (end < data.length && (data.codePointAt(end - 1) ?? 0) > 0xffff) {
      end -= 1;
    }
    yield data.slice(start, end);
    start = end;
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
      index += 1;
    }
  }
  return bytes;
}
