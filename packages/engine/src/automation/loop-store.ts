import type { LoopId, LoopIteration, LoopRecord } from '@linkcode/schema';

/**
 * Durable storage for loops and their per-iteration history. The daemon injects a SQLite-backed
 * implementation; the in-memory default keeps bare engines and tests dependency-free. Loops are
 * whole-record upserts; iterations upsert by (`loopId`, `index`). Live logs are intentionally NOT
 * persisted — they are an ephemeral ring buffer, empty after a restart (which stops the loop anyway).
 */
export interface LoopStore {
  load(): Promise<LoopRecord[]>;
  save(loop: LoopRecord): Promise<void>;
  /** Delete a loop and cascade its iterations. */
  delete(loopId: LoopId): Promise<void>;
  /** Iterations for one loop, oldest-first by index. */
  loadIterations(loopId: LoopId): Promise<LoopIteration[]>;
  /** Upsert an iteration by (`loopId`, `index`). */
  saveIteration(iteration: LoopIteration): Promise<void>;
  /** Every loop still marked `running` — the boot sweep marks these stopped. */
  loadRunning(): Promise<LoopRecord[]>;
}

export class InMemoryLoopStore implements LoopStore {
  private readonly loops = new Map<LoopId, LoopRecord>();
  private readonly iterations = new Map<string, LoopIteration>();

  load(): Promise<LoopRecord[]> {
    return Promise.resolve([...this.loops.values()].map((loop) => structuredClone(loop)));
  }

  save(loop: LoopRecord): Promise<void> {
    this.loops.set(loop.loopId, structuredClone(loop));
    return Promise.resolve();
  }

  delete(loopId: LoopId): Promise<void> {
    this.loops.delete(loopId);
    for (const [key, iteration] of this.iterations) {
      if (iteration.loopId === loopId) this.iterations.delete(key);
    }
    return Promise.resolve();
  }

  loadIterations(loopId: LoopId): Promise<LoopIteration[]> {
    const iterations: LoopIteration[] = [];
    for (const iteration of this.iterations.values()) {
      if (iteration.loopId === loopId) iterations.push(structuredClone(iteration));
    }
    iterations.sort((a, b) => a.index - b.index);
    return Promise.resolve(iterations);
  }

  saveIteration(iteration: LoopIteration): Promise<void> {
    this.iterations.set(`${iteration.loopId}#${iteration.index}`, structuredClone(iteration));
    return Promise.resolve();
  }

  loadRunning(): Promise<LoopRecord[]> {
    const running: LoopRecord[] = [];
    for (const loop of this.loops.values()) {
      if (loop.status === 'running') running.push(structuredClone(loop));
    }
    return Promise.resolve(running);
  }
}
