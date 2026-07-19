import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { toRequestFailure } from '../failure';

export class WireResponder {
  constructor(private readonly transport: Transport) {}

  async tryReply(replyTo: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.sendFailure(replyTo, error);
    }
  }

  sendFailure(replyTo: string, error: unknown): void {
    const { code, message } = toRequestFailure(error);
    this.transport.send(createWireMessage({ kind: 'request.failed', replyTo, code, message }));
  }

  sendSuccess(replyTo: string): void {
    this.transport.send(createWireMessage({ kind: 'request.succeeded', replyTo }));
  }
}
