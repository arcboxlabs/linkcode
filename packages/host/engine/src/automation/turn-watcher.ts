import type { AgentAdapter } from '@linkcode/agent-adapter';
import type { AgentEvent, MessageId, StopReason } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';

/** The outcome of one driven turn. */
export interface TurnResult {
  stopReason: StopReason;
  /** Concatenated assistant text of the turn's message segments (distinct bubbles joined by blank lines). */
  text: string;
}

function joinSegments(segments: Map<MessageId, string>): string {
  return Array.from(segments.values())
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/**
 * Drive one turn on a live adapter and resolve with its final assistant text and stop reason. Adds a
 * *second* `onEvent` listener (the adapter's Listeners set is multi-subscriber), leaving the engine's
 * own broadcast listener untouched. Subscribes *before* invoking `send`, since a fast provider can
 * emit the turn's events before the dispatch promise resolves.
 *
 * Rejects — never hangs — on an unrecoverable error event, an adapter `status: 'stopped'` (the turn
 * was torn down), a permission/question ask (this is an unattended run: cancel the turn and fail it),
 * a `send` rejection, or `opts.timeoutMs` elapsing. On every reject it best-effort cancels the turn so
 * the underlying session returns to idle.
 */
export function watchTurn(
  adapter: Pick<AgentAdapter, 'onEvent' | 'send'>,
  send: () => Promise<void>,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TurnResult> {
  return new Promise<TurnResult>((resolve, reject) => {
    const segments = new Map<MessageId, string>();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsub: () => void = noop;
    let removeAbortListener: () => void = noop;

    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      unsub();
      removeAbortListener();
      act();
    };

    const cancelAndReject = (message: string): void => {
      finish(() => {
        void adapter.send({ type: 'cancel' }).catch(noop);
        reject(new Error(message));
      });
    };

    unsub = adapter.onEvent((event: AgentEvent) => {
      switch (event.type) {
        case 'agent-message-chunk':
          if (event.content.type === 'text') {
            segments.set(
              event.messageId,
              (segments.get(event.messageId) ?? '') + event.content.text,
            );
          }
          break;
        case 'stop':
          finish(() => resolve({ stopReason: event.stopReason, text: joinSegments(segments) }));
          break;
        case 'status':
          // The turn was torn down without a `stop` (cancel, adapter shutdown) — it will never settle.
          if (event.status === 'stopped') {
            finish(() => reject(new Error('session stopped before the turn finished')));
          }
          break;
        case 'error':
          // Recoverable errors are surfaced to the client but the turn still settles on `stop`;
          // only a fatal one guarantees no `stop` is coming. `emitError` always sets `recoverable`.
          if (!event.recoverable) finish(() => reject(new Error(event.message)));
          break;
        case 'permission-request':
          cancelAndReject(`waiting for permission: ${event.toolCall.title}`);
          break;
        case 'question-request':
          cancelAndReject('waiting for input');
          break;
        default:
          break;
      }
    });

    const abort = (): void => cancelAndReject('turn cancelled');
    if (opts.signal?.aborted) {
      abort();
      return;
    }
    if (opts.signal) {
      opts.signal.addEventListener('abort', abort, { once: true });
      removeAbortListener = () => opts.signal?.removeEventListener('abort', abort);
    }

    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(
        () => cancelAndReject(`turn timed out after ${opts.timeoutMs}ms`),
        opts.timeoutMs,
      );
    }

    send().catch((err: unknown) => {
      finish(() => reject(new Error(extractErrorMessage(err) ?? 'failed to dispatch the turn')));
    });
  });
}
