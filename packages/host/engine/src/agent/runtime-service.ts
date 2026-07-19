import type { AgentRuntimes } from '@linkcode/schema';
import { jsonValueEqual } from '../json-equal';

const REVALIDATE_COOLDOWN_MS = 5000;

interface AgentRuntimeServiceOptions {
  readonly initial?: AgentRuntimes;
  readonly ready?: Promise<AgentRuntimes>;
  readonly collect?: () => Promise<AgentRuntimes>;
  readonly onChanged: (runtimes: AgentRuntimes) => void;
  readonly onError: (message: string, error: unknown) => void;
}

export class AgentRuntimeService {
  readonly ready: Promise<void>;
  private runtimes: AgentRuntimes;
  private seeded = true;
  private collectTail: Promise<void> = Promise.resolve();
  private activeCollects = 0;
  private collectedAt = 0;
  private pendingEventCollect: Promise<void> | undefined;

  constructor(private readonly options: AgentRuntimeServiceOptions) {
    this.runtimes = options.initial ?? {};
    this.ready = options.ready ? this.seed(options.ready) : Promise.resolve();
  }

  serve(reply: (runtimes: AgentRuntimes) => void): void {
    if (this.seeded) {
      reply(this.runtimes);
      this.revalidate();
      return;
    }
    void this.ready.then(() => {
      reply(this.runtimes);
      this.revalidate();
    });
  }

  refresh(): Promise<void> {
    if (!this.options.collect) return Promise.resolve();
    const pending = this.pendingEventCollect;
    if (pending) return pending;
    const pass = this.enqueue(true, () => {
      if (this.pendingEventCollect === pass) this.pendingEventCollect = undefined;
    });
    this.pendingEventCollect = pass;
    return pass;
  }

  private seed(ready: Promise<AgentRuntimes>): Promise<void> {
    this.seeded = false;
    this.activeCollects += 1;
    const pass = ready
      .then((runtimes) => {
        this.runtimes = runtimes;
        this.collectedAt = Date.now();
        this.options.onChanged(runtimes);
      })
      .catch((error: unknown) => {
        this.options.onError('Boot agent-runtime probe failed:', error);
      })
      .finally(() => {
        this.seeded = true;
        this.activeCollects -= 1;
      });
    this.collectTail = pass;
    return pass;
  }

  private revalidate(): void {
    if (!this.options.collect) return;
    if (this.activeCollects > 0) return;
    if (Date.now() - this.collectedAt < REVALIDATE_COOLDOWN_MS) return;
    void this.enqueue(false);
  }

  private enqueue(pushUnchanged: boolean, onStart?: () => void): Promise<void> {
    const collect = this.options.collect;
    if (!collect) return Promise.resolve();
    this.activeCollects += 1;
    const pass = this.collectTail.then(async () => {
      onStart?.();
      try {
        const next = await collect();
        const changed = !jsonValueEqual(next, this.runtimes);
        this.runtimes = next;
        this.collectedAt = Date.now();
        if (changed || pushUnchanged) this.options.onChanged(next);
      } catch (error) {
        this.options.onError('Re-probing agent runtimes failed:', error);
      } finally {
        this.activeCollects -= 1;
      }
    });
    this.collectTail = pass;
    return pass;
  }
}
