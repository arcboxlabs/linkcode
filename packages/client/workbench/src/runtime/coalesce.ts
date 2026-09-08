import { noop } from 'foxts/noop';

/**
 * Collapse a burst of triggers into one in-flight run plus at most one trailing run. A trigger
 * arriving mid-run must still cause another run: the one in flight may have read state older than
 * the event that triggered it. A failed run does not abort the drain — the caller's own error
 * pipeline reports it, and dropping the trailing run would leave exactly the staleness the caller
 * is revalidating away.
 */
export function coalesceRuns(run: () => Promise<unknown>): () => void {
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
      } while (takeQueued());
    } finally {
      running = false;
    }
  };

  return () => {
    if (running) {
      queued = true;
      return;
    }
    void drain().catch(noop);
  };
}
