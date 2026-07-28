import { describe, expect, it } from 'vitest';
import { RingBuffer } from '../automation/ring-buffer';

describe('RingBuffer', () => {
  it('drops the oldest entries past capacity and snapshots in order', () => {
    const buffer = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i += 1) buffer.push(i);
    expect(buffer.size).toBe(3);
    expect(buffer.snapshot()).toEqual([3, 4, 5]);
  });
});
