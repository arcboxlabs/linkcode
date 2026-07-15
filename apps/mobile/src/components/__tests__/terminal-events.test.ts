import type { TerminalReplayEvent } from '@linkcode/schema';
import { createFixedArray } from 'foxts/create-fixed-array';
import { describe, expect, it } from 'vitest';
import { batchTerminalEvents } from '../terminal-events';

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe('batchTerminalEvents', () => {
  it('preserves event order while enforcing bridge limits', () => {
    const events: TerminalReplayEvent[] = [
      { type: 'write', seq: 1, data: 'before' },
      ...createFixedArray(129).map(
        (index): TerminalReplayEvent => ({
          type: 'resize',
          seq: index + 2,
          cols: 80 + index,
          rows: 24,
        }),
      ),
      { type: 'write', seq: 131, data: 'after' },
    ];

    const batches = batchTerminalEvents(events);
    const flattened = batches.flat();

    expect(flattened[0]).toEqual(['w', 'before']);
    expect(flattened.at(-1)).toEqual(['w', 'after']);
    expect(batches.every((batch) => batch.length <= 128)).toBe(true);
    expect(batches.every((batch) => serializedBytes(batch) <= 64 * 1024)).toBe(true);
  });

  it('splits oversized writes without corrupting surrogate pairs', () => {
    const data = `${'\0'.repeat(9000)}${'🚀'.repeat(5000)}`;
    const batches = batchTerminalEvents([{ type: 'write', seq: 1, data }]);
    const chunks = batches.flat().map((event) => {
      expect(event[0]).toBe('w');
      return event[1] as string;
    });

    expect(chunks.join('')).toBe(data);
    expect(
      chunks.every((chunk) => {
        const first = chunk.codePointAt(0) ?? 0;
        const last = chunk.codePointAt(chunk.length - 1) ?? 0;
        return (first < 0xdc00 || first > 0xdfff) && (last < 0xd800 || last > 0xdbff);
      }),
    ).toBe(true);
    expect(batches.every((batch) => serializedBytes(batch) <= 64 * 1024)).toBe(true);
  });
});
