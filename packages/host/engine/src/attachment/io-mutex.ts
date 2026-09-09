import { noop } from 'foxts/noop';

/**
 * Serializes blob publish + row insert with GC unlinks. A doomed id can grow a new row between
 * the reaper transaction and the unlink; those two must not overlap.
 */
export class AttachmentIoMutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = noop;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.catch(noop).then(work).finally(release);
  }
}
