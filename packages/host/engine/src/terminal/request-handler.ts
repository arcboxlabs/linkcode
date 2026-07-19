import type { TerminalAttachmentCredentials, WirePayload } from '@linkcode/schema';
import { RequestError } from '../failure';
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

  async handle(payload: TerminalRequest): Promise<void> {
    switch (payload.kind) {
      case 'terminal.open':
        await this.withTerminals(payload.clientReqId, (terminals) =>
          terminals.open(payload.clientReqId, payload.opts, attachment(payload)),
        );
        break;
      case 'terminal.list':
        if (this.terminals) {
          this.terminals.list(payload.clientReqId);
        } else {
          this.unsupported(payload.clientReqId);
        }
        break;
      case 'terminal.attach':
        await this.withTerminals(payload.clientReqId, (terminals) => {
          terminals.attach(
            payload.clientReqId,
            payload.terminalId,
            attachment(payload),
            payload.mode,
          );
        });
        break;
      case 'terminal.detach':
        this.terminals?.detach(payload.terminalId, attachment(payload));
        break;
      case 'terminal.input':
        this.terminals?.input(payload.terminalId, attachment(payload), payload.data);
        break;
      case 'terminal.ack':
        this.terminals?.ack(payload.terminalId, attachment(payload), payload.acked);
        break;
      case 'terminal.resize':
        this.terminals?.resize(payload.terminalId, attachment(payload), payload.cols, payload.rows);
        break;
      case 'terminal.close':
        this.terminals?.close(payload.terminalId, attachment(payload));
        break;
      default:
        break;
    }
  }

  private async withTerminals(
    replyTo: string,
    fn: (terminals: TerminalService) => void | Promise<void>,
  ): Promise<void> {
    const terminals = this.terminals;
    if (!terminals) {
      this.unsupported(replyTo);
      return;
    }
    await this.responder.tryReply(replyTo, () => fn(terminals));
  }

  private unsupported(replyTo: string): void {
    this.responder.sendFailure(
      replyTo,
      new RequestError({
        code: 'unsupported',
        message: 'Terminals are not supported on this host',
      }),
    );
  }
}
