/**
 * A fixed-capacity circular FIFO buffer: pushing past `capacity` overwrites the oldest entry in
 * place. Used for a loop's live log tail, which streams unbounded but is only ever inspected as a
 * recent window. {@link snapshot} always returns entries oldest-first.
 */
export class RingBuffer<T> {
  private readonly items: T[] = [];
  /** Index of the oldest entry once the buffer is full; unused (0) while still filling. */
  private head = 0;

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
    } else {
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
    }
  }

  snapshot(): T[] {
    if (this.items.length < this.capacity) return [...this.items];
    return [...this.items.slice(this.head), ...this.items.slice(0, this.head)];
  }

  get size(): number {
    return this.items.length;
  }
}
