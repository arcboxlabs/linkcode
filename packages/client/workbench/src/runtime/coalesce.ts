import { noop } from 'foxts/noop';

/**
 * Mid-run triggers need one trailing run; abort discards it without cancelling active work.
 * The caller owns error reporting; a failed run still drains queued changes unless aborted.
 */
export function coalesceRuns(run: () => Promise<unknown>, signal: AbortSignal): () => void {
  let running = false;
  let queued = false;

  // Read through a call, not `while (queued)`: the flag is only ever set from the closure below
  // while a run is awaited, which narrowing cannot see.
  const takeQueued = (): boolean => {
    const wasQueued = queued;
    queued = false;
    return wasQueued;
  };

  const drain = async (): Promise<void> => {
    running = true;
    try {
      do {
        // eslint-disable-next-line no-await-in-loop -- serializing is the point: one run at a time
        await run().catch(noop);
      } while (!signal.aborted && takeQueued());
    } finally {
      running = false;
    }
  };

  return () => {
    if (signal.aborted) return;
    if (running) {
      queued = true;
      return;
    }
    void drain().catch(noop);
  };
}
