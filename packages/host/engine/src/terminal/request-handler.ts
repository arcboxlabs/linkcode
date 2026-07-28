import type { TerminalAttachmentCredentials, WirePayload } from '@linkcode/schema';
import { Effect } from 'effect';
import type { EngineFailure } from '../failure';
import { RequestError, toOperationFailure } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { TerminalService } from './service';

type TerminalRequest = Extract<
  WirePayload,
  {
    kind:
      | 'terminal.open'
      | 'terminal.list'
      | 'terminal.attach'
      | 'terminal.detach'
      | 'terminal.input'
      | 'terminal.ack'
      | 'terminal.resize'
      | 'terminal.close';
  }
>;

type TerminalAttachmentRequest = Exclude<TerminalRequest, { kind: 'terminal.list' }>;

function attachment(payload: TerminalAttachmentRequest): TerminalAttachmentCredentials {
  return {
    attachmentId: payload.attachmentId,
    attachmentSecret: payload.attachmentSecret,
  };
}

/** Translates inbound terminal wire requests into operations on the optional host PTY service. */
export class TerminalRequestHandler {
  constructor(
    private readonly terminals: TerminalService | undefined,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: TerminalRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'terminal.open':
        return this.withTerminals(payload.clientReqId, (terminals) =>
          terminalOperation('terminal.open', 'Failed to open terminal', (signal) =>
            terminals.open(payload.clientReqId, payload.opts, attachment(payload), signal),
          ),
        );
      case 'terminal.list':
        return this.withTerminals(payload.clientReqId, (terminals) =>
          syncTerminalOperation('terminal.list', 'Failed to list terminals', () =>
            terminals.list(payload.clientReqId),
          ),
        );
      case 'terminal.attach':
        return this.withTerminals(payload.clientReqId, (terminals) =>
          syncTerminalOperation('terminal.attach', 'Failed to attach terminal', () =>
            terminals.attach(
              payload.clientReqId,
              payload.terminalId,
              attachment(payload),
              payload.mode,
            ),
          ),
        );
      case 'terminal.detach':
        return Effect.sync(() => this.terminals?.detach(payload.terminalId, attachment(payload)));
      case 'terminal.input':
        return Effect.sync(() =>
          this.terminals?.input(payload.terminalId, attachment(payload), payload.data),
        );
      case 'terminal.ack':
        return Effect.sync(() =>
          this.terminals?.ack(payload.terminalId, attachment(payload), payload.acked),
        );
      case 'terminal.resize':
        return Effect.sync(() =>
          this.terminals?.resize(
            payload.terminalId,
            attachment(payload),
            payload.cols,
            payload.rows,
          ),
        );
      case 'terminal.close':
        return Effect.sync(() => this.terminals?.close(payload.terminalId, attachment(payload)));
      default:
        return Effect.void;
    }
  }

  private withTerminals(
    replyTo: string,
    fn: (terminals: TerminalService) => Effect.Effect<void, EngineFailure>,
  ): Effect.Effect<void> {
    const operation = this.terminals
      ? fn(this.terminals)
      : Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: 'Terminals are not supported on this host',
          }),
        );
    return this.responder.reply(replyTo, operation);
  }
}

function terminalOperation(
  operation: string,
  publicMessage: string,
  run: (signal: AbortSignal) => PromiseLike<void>,
): Effect.Effect<void, EngineFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'pty', operation, publicMessage }),
  });
}

function syncTerminalOperation(
  operation: string,
  publicMessage: string,
  run: () => void,
): Effect.Effect<void, EngineFailure> {
  return Effect.try({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'pty', operation, publicMessage }),
  });
}
