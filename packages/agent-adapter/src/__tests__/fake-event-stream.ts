import type { Event } from '@opencode-ai/sdk/v2';

/** Stands in for the SSE `ServerSentEventsResult['stream']` `event.subscribe()` resolves to: an
 * async-iterable queue tests push events into, mirroring the real for-await the adapter drains.
 * Shared by every opencode test file so the one stream double models the one production stream —
 * a failure mode added here (e.g. a new terminal frame kind) is exercised by all of them. */
export class FakeEventStream {
  private readonly queued: Array<{ event: unknown } | { done: true } | { failed: unknown }> = [];
  private waiting: (() => void) | null = null;

  push(event: Event): void {
    this.queued.push({ event });
    this.flush();
  }

  /** A raw, possibly malformed payload — bypasses the `Event` shape `push()` requires, standing
   * in for a real SSE frame that doesn't match the SDK's declared types. */
  pushRaw(event: unknown): void {
    this.queued.push({ event });
    this.flush();
  }

  /** The server closing the stream on its own, without the adapter having stopped. */
  end(): void {
    this.queued.push({ done: true });
    this.flush();
  }

  /** The iterator itself failing (e.g. a dropped connection). */
  fail(err: unknown): void {
    this.queued.push({ failed: err });
    this.flush();
  }

  private flush(): void {
    const wake = this.waiting;
    this.waiting = null;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Event> {
    while (true) {
      if (this.queued.length === 0) {
        // eslint-disable-next-line no-await-in-loop -- queue iterator: the await IS the next-event signal
        await new Promise<void>((resolve) => {
          this.waiting = resolve;
        });
        continue;
      }
      const item = this.queued.shift()!;
      if ('done' in item) return;
      if ('failed' in item) throw item.failed;
      yield item.event as Event;
    }
  }
}
