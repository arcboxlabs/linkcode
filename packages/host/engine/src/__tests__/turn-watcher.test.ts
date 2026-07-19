import type { AgentEvent, AgentInput, MessageId } from '@linkcode/schema';
import { textBlock } from '@linkcode/schema';
import { Cause, Effect, Exit, Fiber } from 'effect';
import { asyncNoop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { watchTurn } from '../automation/turn-watcher';

/** Minimal adapter exposing the two surfaces the watcher touches: onEvent (multi-listener) + send. */
class WatchAdapter {
  readonly sent: AgentInput[] = [];
  private readonly listeners = new Set<(e: AgentEvent) => void>();

  onEvent(cb: (e: AgentEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  send(input: AgentInput): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  emit(event: AgentEvent): void {
    for (const cb of this.listeners) cb(event);
  }
}

function chunk(messageId: string, text: string): AgentEvent {
  return {
    type: 'agent-message-chunk',
    messageId: messageId as MessageId,
    content: textBlock(text),
  };
}

function permissionRequest(title: string): AgentEvent {
  return {
    type: 'permission-request',
    requestId: 'req-1',
    toolCall: { toolCallId: 'tc-1', title },
    options: [],
  };
}

describe('watchTurn', () => {
  it('concatenates chunks by messageId and resolves on stop', async () => {
    const a = new WatchAdapter();
    const result = Effect.runPromise(
      watchTurn(a, () => a.send({ type: 'prompt', content: [textBlock('go')] })),
    );
    await Promise.resolve();
    a.emit(chunk('m1', 'Hello '));
    a.emit(chunk('m1', 'world'));
    a.emit(chunk('m2', 'done'));
    a.emit({ type: 'stop', stopReason: 'end_turn' });
    await expect(result).resolves.toEqual({ stopReason: 'end_turn', text: 'Hello world\n\ndone' });
    expect(a.sent).toEqual([{ type: 'prompt', content: [textBlock('go')] }]);
    expect(a.listenerCount()).toBe(0);
  });

  it('rejects when the session stops before the turn finishes', async () => {
    const a = new WatchAdapter();
    const result = Effect.runPromise(watchTurn(a, asyncNoop));
    await Promise.resolve();
    a.emit({ type: 'status', status: 'stopped' });
    await expect(result).rejects.toThrow('session stopped before the turn finished');
    expect(a.listenerCount()).toBe(0);
  });

  it('ignores a recoverable error but rejects on a fatal one', async () => {
    const recoverable = new WatchAdapter();
    const ok = Effect.runPromise(watchTurn(recoverable, asyncNoop));
    await Promise.resolve();
    recoverable.emit({ type: 'error', message: 'transient', recoverable: true });
    recoverable.emit({ type: 'stop', stopReason: 'end_turn' });
    await expect(ok).resolves.toMatchObject({ stopReason: 'end_turn' });

    const fatal = new WatchAdapter();
    const bad = Effect.runPromise(watchTurn(fatal, asyncNoop));
    await Promise.resolve();
    fatal.emit({ type: 'error', message: 'boom', recoverable: false });
    await expect(bad).rejects.toThrow('boom');
  });

  it('cancels the turn and rejects on a permission ask', async () => {
    const a = new WatchAdapter();
    const result = Effect.runPromise(watchTurn(a, asyncNoop));
    await Promise.resolve();
    a.emit(permissionRequest('Edit file.ts'));
    await expect(result).rejects.toThrow('waiting for permission: Edit file.ts');
    expect(a.sent).toContainEqual({ type: 'cancel' });
  });

  it('rejects and cancels on timeout', async () => {
    vi.useFakeTimers();
    try {
      const a = new WatchAdapter();
      const result = Effect.runPromise(watchTurn(a, asyncNoop, { timeoutMs: 1000 }));
      const assertion = expect(result).rejects.toThrow('turn timed out after 1000ms');
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(a.sent).toContainEqual({ type: 'cancel' });
      expect(a.listenerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves interruption while cancelling and releasing the listener', async () => {
    const a = new WatchAdapter();
    const fiber = Effect.runFork(watchTurn(a, asyncNoop));
    await vi.waitFor(() => expect(a.listenerCount()).toBe(1));

    await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(a.sent).toEqual([{ type: 'cancel' }]);
    expect(a.listenerCount()).toBe(0);
    a.emit(permissionRequest('Edit file.ts'));
    expect(a.sent).toEqual([{ type: 'cancel' }]);
  });

  it('settles from provider events before the dispatch promise resolves', async () => {
    const a = new WatchAdapter();
    const result = Effect.runPromise(
      watchTurn(
        a,
        () =>
          new Promise<void>(() => {
            a.emit(chunk('m1', 'fast'));
            a.emit({ type: 'stop', stopReason: 'end_turn' });
          }),
      ),
    );

    await expect(result).resolves.toEqual({ stopReason: 'end_turn', text: 'fast' });
    expect(a.listenerCount()).toBe(0);
  });

  it('rejects when send fails', async () => {
    const a = new WatchAdapter();
    const result = Effect.runPromise(
      watchTurn(a, () => Promise.reject(new Error('dispatch failed'))),
    );
    await expect(result).rejects.toThrow('dispatch failed');
    expect(a.listenerCount()).toBe(0);
  });
});
