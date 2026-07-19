import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';

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
    const message = extractErrorMessage(error) ?? 'Unknown error';
    this.transport.send(createWireMessage({ kind: 'request.failed', replyTo, message }));
  }

  sendSuccess(replyTo: string): void {
    this.transport.send(createWireMessage({ kind: 'request.succeeded', replyTo }));
  }
}
