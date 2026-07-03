import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { asyncNoop } from 'foxts/noop';
import { vi } from 'vitest';

export interface QueryInput {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Record<string, unknown>;
}

/** What the fake CLI feeds back to the adapter. The mocked module boundary erases the SDK's
 * message union, so the fake only needs runtime shape. */
export type WireMessage = Record<string, unknown>;

/** Stands in for the SDK's `Query`: exposes the options it was created with, drains the streaming
 * prompt like the real read loop, and lets tests feed messages into the adapter's consume() loop. */
export class FakeQuery {
  readonly options: Record<string, unknown>;
  /** Messages the SDK-side read loop has pulled off the streaming prompt so far. */
  readonly received: SDKUserMessage[] = [];
  readonly applyFlagSettings =
    vi.fn<(settings: Record<string, unknown>) => Promise<void>>(asyncNoop);
  readonly setPermissionMode = vi.fn<(mode: string) => Promise<void>>(asyncNoop);
  readonly close = vi.fn(() => {
    this.push(null);
  });
  private readonly buffered: Array<WireMessage | null> = [];
  private waiting: ((msg: WireMessage | null) => void) | null = null;

  constructor(input: QueryInput) {
    this.options = input.options;
    void (async () => {
      for await (const msg of input.prompt) this.received.push(msg);
    })();
  }

  /** Feed one message to the adapter, as the CLI would. `null` ends the stream (close / crash). */
  push(msg: WireMessage | null): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(msg);
    } else {
      this.buffered.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<WireMessage> {
    while (true) {
      const next =
        this.buffered.length > 0
          ? this.buffered.shift()!
          : await new Promise<WireMessage | null>((resolve) => {
              this.waiting = resolve;
            });
      if (next === null) return;
      yield next;
    }
  }
}
